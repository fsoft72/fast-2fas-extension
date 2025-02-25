class TOTPManager {
  static CHUNK_SIZE = 3000;

  constructor() {
    this.services = [];
    this.totp = new jsOTP.totp();
    this.encryptionKey = null;
    this.keepAlivePort = null;
    this.keepAliveInterval = null;

    this.setupEventListeners();
    this.initialize();
  }

  updateUIState () {
    const keyRequestSection = document.getElementById( 'keyRequestSection' );
    const clearKeyButton = document.getElementById( 'clearKey' );
    const mainContent = document.getElementById( 'mainContent' );

    if ( this.encryptionKey ) {
      // Key is set
      keyRequestSection.classList.add( 'hidden' );
      clearKeyButton.classList.remove( 'hidden' );
      mainContent.classList.remove( 'hidden' );
    } else {
      // No key set
      keyRequestSection.classList.remove( 'hidden' );
      clearKeyButton.classList.add( 'hidden' );
      mainContent.classList.add( 'hidden' );
    }
  }


  async clearSessionKey () {
    this.encryptionKey = null;
    await chrome.runtime.sendMessage( {
      type: 'clearEncryptionKey'
    } );
    document.getElementById( 'encryptionKey' ).value = '';
    document.getElementById( 'keyStatus' ).textContent = 'Session key cleared';
    this.updateUIState();
  }

  async initialize () {
    const response = await chrome.runtime.sendMessage( { type: 'getEncryptionKey' } );
    if ( response.key ) {
      this.encryptionKey = response.key;
      document.getElementById( 'keyStatus' ).textContent = 'Key loaded from session';
      await this.loadServices();
      this.updateUIState();
    } else {
      await this.checkEncryptionKey();
      this.updateUIState();
    }
  }

  async setEncryptionKey ( password ) {
    const derivedKey = await this.deriveKey( password );
    await chrome.storage.local.set( { keyCheck: derivedKey } );
    this.encryptionKey = password;

    await chrome.runtime.sendMessage( {
      type: 'setEncryptionKey',
      key: password
    } );

    await this.loadServices();
    document.getElementById( 'keyStatus' ).textContent = 'Key set successfully';
    this.updateUIState();
    this.startKeepAlive(); // Start the keepalive connection when setting the key
  }

  async startKeepAlive () {
    // Clear any existing keepAlive connections
    this.stopKeepAlive();

    // Establish a long-lived connection
    this.keepAlivePort = chrome.runtime.connect( { name: 'keepAlive' } );

    // Set up a ping interval to keep the connection active
    this.keepAliveInterval = setInterval( () => {
      chrome.runtime.sendMessage( { keepAlive: true }, ( response ) => {
        if ( chrome.runtime.lastError ) {
          this.stopKeepAlive();
        }
      } );
    }, 1000 );
  }

  stopKeepAlive () {
    if ( this.keepAliveInterval ) {
      clearInterval( this.keepAliveInterval );
      this.keepAliveInterval = null;
    }
    if ( this.keepAlivePort ) {
      this.keepAlivePort.disconnect();
      this.keepAlivePort = null;
    }
    chrome.runtime.sendMessage( { keepAlive: false } );
  }

  async checkEncryptionKey () {
    const stored = await chrome.storage.local.get( 'keyCheck' );
    if ( stored.keyCheck ) {
      document.getElementById( 'keyStatus' ).textContent = 'Enter key to unlock';
    } else {
      document.getElementById( 'keyStatus' ).textContent = 'Set new encryption key';
    }
  }

  async deriveKey ( password ) {
    const encoder = new TextEncoder();
    const data = encoder.encode( password );
    const hash = await crypto.subtle.digest( 'SHA-256', data );
    return Array.from( new Uint8Array( hash ) )
      .map( b => b.toString( 16 ).padStart( 2, '0' ) )
      .join( '' );
  }

  async resetAll () {
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
    await this.clearSessionKey();

    this.services = [];
    document.getElementById( 'serviceSelect' ).innerHTML = '<option value="">Select a service</option>';
    document.getElementById( 'totpCode' ).textContent = '';
    document.getElementById( 'timeRemaining' ).textContent = '';

    await this.checkEncryptionKey();
    this.updateUIState();
  }

  async getOrCreateKey () {
    let key = await chrome.storage.local.get( 'encryptionKey' );
    if ( !key.encryptionKey ) {
      // Generate random encryption key
      const buffer = new Uint8Array( 32 );
      crypto.getRandomValues( buffer );
      key.encryptionKey = Array.from( buffer ).map( b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
      await chrome.storage.local.set( { encryptionKey: key.encryptionKey } );
    }
    return key.encryptionKey;
  }

  async encrypt ( data ) {
    const key = await this.getOrCreateKey();
    const iv = crypto.getRandomValues( new Uint8Array( 12 ) );
    const encoder = new TextEncoder();
    const keyBuffer = await crypto.subtle.importKey(
      'raw',
      new Uint8Array( key.match( /.{2}/g ).map( byte => parseInt( byte, 16 ) ) ),
      { name: 'AES-GCM' },
      false,
      [ 'encrypt' ]
    );

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      keyBuffer,
      encoder.encode( JSON.stringify( data ) )
    );

    return {
      iv: Array.from( iv ).map( b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' ),
      data: Array.from( new Uint8Array( encrypted ) ).map( b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' )
    };
  }

  async decrypt ( encrypted ) {
    const key = await this.getOrCreateKey();
    const keyBuffer = await crypto.subtle.importKey(
      'raw',
      new Uint8Array( key.match( /.{2}/g ).map( byte => parseInt( byte, 16 ) ) ),
      { name: 'AES-GCM' },
      false,
      [ 'decrypt' ]
    );

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array( encrypted.iv.match( /.{2}/g ).map( byte => parseInt( byte, 16 ) ) )
      },
      keyBuffer,
      new Uint8Array( encrypted.data.match( /.{2}/g ).map( byte => parseInt( byte, 16 ) ) )
    );

    return JSON.parse( new TextDecoder().decode( decrypted ) );
  }

  async verifyKey ( key ) {
    const stored = await chrome.storage.local.get( 'keyCheck' );
    if ( !stored.keyCheck ) return true;

    const derivedKey = await this.deriveKey( key );
    return stored.keyCheck === derivedKey;
  }


  async saveServices () {
    if ( !this.encryptionKey ) return;

    // Clear existing chunks first
    await chrome.storage.sync.clear();

    // Convert and split data
    const servicesJson = JSON.stringify( this.services );
    const chunks = [];

    for ( let i = 0; i < servicesJson.length; i += this.constructor.CHUNK_SIZE ) {
      chunks.push( servicesJson.slice( i, i + this.constructor.CHUNK_SIZE ) );
    }

    // Save chunks and metadata
    const metadata = { totalChunks: chunks.length };
    await chrome.storage.sync.set( { metadata } );

    // Save each chunk individually with index
    for ( let i = 0; i < chunks.length; i++ ) {
      const encrypted = await this.encrypt( chunks[ i ] );
      const key = `chunk_${ i }`;
      // Log chunk size before saving
      console.log( `Chunk ${ i } size:`, new TextEncoder().encode( JSON.stringify( { [ key ]: encrypted } ) ).length );
      await chrome.storage.sync.set( { [ key ]: encrypted } );
    }
  }

  async loadServices () {
    if ( !this.encryptionKey ) return;

    // Get metadata
    const { metadata } = await chrome.storage.sync.get( 'metadata' );
    if ( !metadata ) {
      this.services = [];
      return;
    }

    // Load all chunks
    let servicesJson = '';
    for ( let i = 0; i < metadata.totalChunks; i++ ) {
      const { [ `chunk_${ i }` ]: chunk } = await chrome.storage.sync.get( `chunk_${ i }` );
      if ( !chunk ) continue;
      const decrypted = await this.decrypt( chunk );
      servicesJson += decrypted;
    }

    try {
      this.services = JSON.parse( servicesJson );
      this.updateServicesList();
    } catch ( e ) {
      console.error( 'Failed to parse services:', e );
      this.services = [];
    }
  }



  startTokenRefresh ( serviceIndex ) {
    if ( this.currentTimer ) {
      clearInterval( this.currentTimer );
    }

    const updateToken = () => {
      const service = this.services[ serviceIndex ];
      const code = this.generateTOTP( service.secret );
      document.getElementById( 'totpCode' ).textContent = code;

      // Calculate and show remaining seconds
      const secondsLeft = 30 - ( Math.floor( Date.now() / 1000 ) % 30 );
      document.getElementById( 'timeRemaining' ).textContent = `(${ secondsLeft }s)`;
    };

    // Initial update
    updateToken();
    // Update every second
    this.currentTimer = setInterval( updateToken, 1000 );
  }

  updateServicesList () {
    const select = document.getElementById( 'serviceSelect' );
    select.innerHTML = '<option value="">Select a service</option>';

    const opts = this.services.map( ( service, index ) => {
      return [ `${ service.name } (${ service.otp.label })`, index ];
    } );

    // sort opts by service name
    opts.sort( ( [ a ], [ b ] ) => a.localeCompare( b ) );

    opts.forEach( ( [ text, value ] ) => {
      const option = document.createElement( 'option' );
      option.value = value;
      option.textContent = text;
      select.appendChild( option );
    } );
  }

  generateTOTP ( secret ) {
    // Get current Unix timestamp in seconds
    const epoch = Math.floor( Date.now() / 1000 );
    return this.totp.getOtp( secret, epoch );
  }

  setupEventListeners () {
    // Import handler
    document.getElementById( 'importTrigger' ).addEventListener( 'click', () => {
      chrome.windows.create( {
        url: 'import.html',
        type: 'popup',
        width: 400,
        height: 300
      } );
    } );

    document.getElementById( 'clearKey' ).addEventListener( 'click', () => {
      this.clearSessionKey();
    } );

    // Listen for imported services
    chrome.runtime.onMessage.addListener( async ( message ) => {
      if ( message.type === 'servicesImported' && message.services ) {
        try {
          this.services = message.services.map( service => ( {
            name: service.name,
            secret: service.secret,
            otp: {
              label: service.otp.label || service.otp.account || service.name,
              digits: service.otp.digits || 6,
              period: service.otp.period || 30,
              algorithm: service.otp.algorithm || 'SHA1'
            }
          } ) );

          await this.saveServices();
          this.updateServicesList();
        } catch ( error ) {
          console.error( 'Failed to process imported services:', error );
        }
      }
    } );

    // Service selection handler
    document.getElementById( 'serviceSelect' ).addEventListener( 'change', ( e ) => {
      if ( e.target.value === '' ) {
        document.getElementById( 'totpCode' ).textContent = '';
        document.getElementById( 'timeRemaining' ).textContent = '';
        if ( this.currentTimer ) {
          clearInterval( this.currentTimer );
          this.currentTimer = null;
        }
        return;
      }

      this.startTokenRefresh( e.target.value );
    } );

    // Copy button handler
    /*
    document.getElementById( 'copyButton' ).addEventListener( 'click', () => {
      const code = document.getElementById( 'totpCode' ).textContent;
      if ( code ) {
        navigator.clipboard.writeText( code );
      }
    } );
     */

    const handleSetKey = async () => {
      const password = document.getElementById( 'encryptionKey' ).value;
      if ( !password ) return;

      const isValid = await this.verifyKey( password );
      if ( isValid ) {
        await this.setEncryptionKey( password );
        document.getElementById( 'keyStatus' ).textContent = 'Key set successfully';
      } else {
        document.getElementById( 'keyStatus' ).textContent = 'Invalid key';
      }
    };

    document.getElementById( 'encryptionKey' ).addEventListener( 'keypress', async ( e ) => {
      if ( e.key === 'Enter' ) {
        e.preventDefault();
        await handleSetKey();
      }
    } );

    document.getElementById( 'setKey' ).addEventListener( 'click', async () => {
      const password = document.getElementById( 'encryptionKey' ).value;
      if ( !password ) return;

      const isValid = await this.verifyKey( password );
      if ( isValid ) {
        await this.setEncryptionKey( password );
        document.getElementById( 'keyStatus' ).textContent = 'Key set successfully';
      } else {
        document.getElementById( 'keyStatus' ).textContent = 'Invalid key';
      }
    } );

    document.getElementById( 'resetAll' ).addEventListener( 'click', async () => {
      if ( confirm( 'This will delete all services and reset the encryption key. Are you sure?' ) ) {
        await this.resetAll();
      }
    } );

  }
}

// Initialize the TOTP manager when the popup opens
document.addEventListener( 'DOMContentLoaded', () => {
  new TOTPManager();
} );