class TOTPManager {
  static CHUNK_SIZE = 3000;

  constructor() {
    this.services = [];
    this.totp = new jsOTP.totp();
    this.encryptionKey = null;
    this.keepAlivePort = null;
    this.keepAliveInterval = null;

    this.setupEventListeners();
    this.loadServices();
    this.checkEncryptionKey();
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
    // Clear storages
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();

    // Clear memory
    this.services = [];
    this.encryptionKey = null;

    // Clear UI
    document.getElementById( 'serviceSelect' ).innerHTML = '';
    document.getElementById( 'totpCode' ).textContent = '';
    document.getElementById( 'timeRemaining' ).textContent = '';
    document.getElementById( 'encryptionKey' ).value = '';

    // Reset key status
    await this.checkEncryptionKey();
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

  async setEncryptionKey ( password ) {
    const derivedKey = await this.deriveKey( password );
    await chrome.storage.local.set( { keyCheck: derivedKey } );
    this.encryptionKey = password;
    await this.loadServices();
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
    const fileInput = document.getElementById( 'importFile' );
    const importTrigger = document.getElementById( 'importTrigger' );

    // Modify the import trigger to open a new window
    document.getElementById( 'importTrigger' ).addEventListener( 'click', () => {
      chrome.windows.create( {
        url: 'import.html',
        type: 'popup',
        width: 400,
        height: 300
      } );
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

    fileInput.addEventListener( 'change', async ( e ) => {
      e.stopPropagation();
      e.preventDefault();

      const file = e.target.files[ 0 ];
      if ( !file ) {
        this.stopKeepAlive();
        return;
      }

      importTrigger.disabled = true;
      importTrigger.textContent = 'Importing...';

      try {
        const reader = new FileReader();
        const fileContents = await new Promise( ( resolve, reject ) => {
          reader.onload = () => resolve( reader.result );
          reader.onerror = () => reject( reader.error );
          reader.readAsText( file );
        } );

        const importedData = JSON.parse( fileContents );
        if ( !importedData.services || !Array.isArray( importedData.services ) ) {
          throw new Error( 'Invalid format: missing services array' );
        }

        this.services = importedData.services.map( service => ( {
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
        alert( 'Services imported successfully' );

      } catch ( error ) {
        console.error( 'Import failed:', error );
        alert( 'Failed to import services: ' + error.message );
      } finally {
        importTrigger.disabled = false;
        importTrigger.textContent = 'Import';
        fileInput.value = '';
        this.stopKeepAlive();
      }
    } );

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

    document.getElementById( 'serviceSelect' ).addEventListener( 'change', ( e ) => {
      if ( e.target.value === '' ) {
        document.getElementById( 'totpCode' ).textContent = '';
        return;
      }

      const service = this.services[ e.target.value ];
      const code = this.generateTOTP( service.secret );
      document.getElementById( 'totpCode' ).textContent = code;
    } );

    document.getElementById( 'copyButton' ).addEventListener( 'click', () => {
      const code = document.getElementById( 'totpCode' ).textContent;
      if ( code ) {
        navigator.clipboard.writeText( code );
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