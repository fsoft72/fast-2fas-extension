class TOTPManager {
  static CHUNK_SIZE = 3000;

  constructor() {
    this.services = [];
    this.totp = new jsOTP.totp();
    this.isUnlocked = false;
    this.aesKeyHex = null;

    this.setupEventListeners();
    this.initialize();
  }

  /** Update the UI to reflect locked/unlocked state. */
  updateUIState () {
    const keyRequestSection = document.getElementById( 'keyRequestSection' );
    const mainContent = document.getElementById( 'mainContent' );

    if ( this.isUnlocked ) {
      keyRequestSection.classList.add( 'hidden' );
      mainContent.classList.remove( 'hidden' );
    } else {
      keyRequestSection.classList.remove( 'hidden' );
      mainContent.classList.add( 'hidden' );
    }
  }

  /**
   * Initialize the app: check for a cached session key, or show the lock screen.
   * If a session key is found, load services directly (no password re-verification needed).
   */
  async initialize () {
    const sessionKey = await this.getSessionKey();
    if ( sessionKey ) {
      this.aesKeyHex = sessionKey;
      this.isUnlocked = true;

      const keyStatusEl = document.getElementById( 'keyStatus' );
      keyStatusEl.textContent = 'Key verified successfully';
      keyStatusEl.className = 'success';

      await this.loadServices();
      this.updateUIState();
      return;
    }

    await this.checkEncryptionKey();
    this.updateUIState();
  }

  /**
   * Verify a password against stored credentials.
   * Detects old format (encryptionKey + keyCheck) and triggers migration.
   * For new format, derives keys via PBKDF2 and compares verifyHash.
   * First-time setup (no verifyHash) returns true.
   */
  async verifyKey ( password ) {
    const stored = await chrome.storage.local.get( [ 'encryptionKey', 'keyCheck', 'cryptoSalt', 'verifyHash' ] );

    // Old format detected: migrate
    if ( stored.encryptionKey && stored.keyCheck ) {
      const oldHash = await this._legacySha256( password );
      if ( stored.keyCheck !== oldHash ) return false;

      await this.migrateFromOldFormat( password, stored.encryptionKey );
      return true;
    }

    // First-time setup: no verifyHash stored yet
    if ( !stored.verifyHash ) return true;

    // New format: PBKDF2 verification
    const { verifyHash, aesKeyHex } = await deriveKeys( password, stored.cryptoSalt );
    if ( verifyHash !== stored.verifyHash ) return false;

    this.aesKeyHex = aesKeyHex;
    return true;
  }

  /**
   * Legacy SHA-256 hash for old-format password verification during migration.
   * @param {string} password - The password to hash
   * @returns {Promise<string>} Hex-encoded SHA-256 hash
   */
  async _legacySha256 ( password ) {
    const encoder = new TextEncoder();
    const data = encoder.encode( password );
    const hash = await crypto.subtle.digest( 'SHA-256', data );
    return Array.from( new Uint8Array( hash ) )
      .map( b => b.toString( 16 ).padStart( 2, '0' ) )
      .join( '' );
  }

  /**
   * Migrate from old encryption format (random AES key + SHA-256 keyCheck) to PBKDF2.
   * Decrypts all services with old key, re-encrypts with new PBKDF2-derived key.
   * Old keys are removed last so interruption retries next time.
   * @param {string} password - The verified password
   * @param {string} oldEncryptionKey - The old random AES key from storage
   */
  async migrateFromOldFormat ( password, oldEncryptionKey ) {
    // Decrypt existing services with old key
    const { metadata } = await chrome.storage.sync.get( 'metadata' );
    let services = [];

    if ( metadata ) {
      let servicesJson = '';
      for ( let i = 0; i < metadata.totalChunks; i++ ) {
        const { [ `chunk_${ i }` ]: chunk } = await chrome.storage.sync.get( `chunk_${ i }` );
        if ( !chunk ) continue;
        servicesJson += await decryptData( chunk, oldEncryptionKey );
      }
      if ( servicesJson ) {
        services = JSON.parse( servicesJson );
      }
    }

    // Generate new PBKDF2-based keys
    const cryptoSalt = generateSalt();
    const { verifyHash, aesKeyHex } = await deriveKeys( password, cryptoSalt );
    this.aesKeyHex = aesKeyHex;
    this.services = services;

    // Re-encrypt services with new key (uses write-then-cleanup via saveServices)
    await this.saveServices();

    // Store new credentials
    await chrome.storage.local.set( { cryptoSalt, verifyHash } );

    // Remove old keys last (atomic: interruption retries migration)
    await chrome.storage.local.remove( [ 'encryptionKey', 'keyCheck' ] );
  }

  /**
   * Unlock the app after password verification.
   * First-time: generates salt and derives keys.
   * Subsequent: aesKeyHex is already set by verifyKey().
   * Caches the AES key in session storage if persistMinutes > 0.
   */
  async unlockApp ( password ) {
    const stored = await chrome.storage.local.get( 'verifyHash' );

    // First-time setup: generate salt and derive keys
    if ( !stored.verifyHash ) {
      const cryptoSalt = generateSalt();
      const { verifyHash, aesKeyHex } = await deriveKeys( password, cryptoSalt );
      this.aesKeyHex = aesKeyHex;
      await chrome.storage.local.set( { cryptoSalt, verifyHash } );

      const keyStatusEl = document.getElementById( 'keyStatus' );
      keyStatusEl.textContent = 'New key set successfully!';
      keyStatusEl.className = 'success';
    } else {
      const keyStatusEl = document.getElementById( 'keyStatus' );
      keyStatusEl.textContent = 'Key verified successfully';
      keyStatusEl.className = 'success';
    }

    this.isUnlocked = true;
    await this.loadServices();
    this.updateUIState();

    // Cache AES key in session if persist is set
    const persistMinutes = parseInt( document.getElementById( 'persistMinutes' ).value ) || 0;
    if ( persistMinutes > 0 ) {
      await this.saveSessionKey( this.aesKeyHex, persistMinutes );
      this.updateExpirationDisplay( persistMinutes );
    }
  }

  /** Check storage to determine if user needs to set or enter a key. */
  async checkEncryptionKey () {
    const stored = await chrome.storage.local.get( [ 'verifyHash', 'keyCheck' ] );
    const keyStatusEl = document.getElementById( 'keyStatus' );
    if ( stored.verifyHash || stored.keyCheck ) {
      keyStatusEl.textContent = 'Enter key to unlock';
      keyStatusEl.className = 'info';
    } else {
      keyStatusEl.textContent = 'Set new encryption key';
      keyStatusEl.className = 'info';
    }
  }

  /** Reset all data and return to initial state. */
  async resetAll () {
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
    await this.clearSessionKey();

    this.isUnlocked = false;
    this.aesKeyHex = null;
    this.services = [];
    document.getElementById( 'serviceSelect' ).innerHTML = '<option value="">Select a service</option>';
    document.getElementById( 'totpCode' ).textContent = '';
    document.getElementById( 'timeRemaining' ).textContent = '';
    document.getElementById( 'persistMinutes' ).value = '0';
    this.updateExpirationDisplay( 0 );
    document.getElementById( 'keyStatus' ).className = '';

    await this.checkEncryptionKey();
    this.updateUIState();
  }

  /**
   * Save services using write-then-cleanup strategy to prevent data loss.
   * 1. Write all new chunks (overwrites existing keys)
   * 2. Update metadata with new chunk count
   * 3. Remove excess old chunks
   */
  async saveServices () {
    const servicesJson = JSON.stringify( this.services );
    const chunks = [];

    for ( let i = 0; i < servicesJson.length; i += this.constructor.CHUNK_SIZE ) {
      chunks.push( servicesJson.slice( i, i + this.constructor.CHUNK_SIZE ) );
    }

    // Get old metadata to know how many old chunks exist
    const { metadata: oldMetadata } = await chrome.storage.sync.get( 'metadata' );
    const oldChunkCount = oldMetadata?.totalChunks || 0;

    // Write all new chunks
    for ( let i = 0; i < chunks.length; i++ ) {
      const encrypted = await encryptData( chunks[ i ], this.aesKeyHex );
      await chrome.storage.sync.set( { [ `chunk_${ i }` ]: encrypted } );
    }

    // Update metadata with new chunk count
    await chrome.storage.sync.set( { metadata: { totalChunks: chunks.length } } );

    // Remove excess old chunks (if old had more chunks than new)
    for ( let i = chunks.length; i < oldChunkCount; i++ ) {
      await chrome.storage.sync.remove( `chunk_${ i }` );
    }
  }

  /** Load and decrypt services from sync storage. */
  async loadServices () {
    const { metadata } = await chrome.storage.sync.get( 'metadata' );
    if ( !metadata ) {
      this.services = [];
      return;
    }

    try {
      let servicesJson = '';
      for ( let i = 0; i < metadata.totalChunks; i++ ) {
        const { [ `chunk_${ i }` ]: chunk } = await chrome.storage.sync.get( `chunk_${ i }` );
        if ( !chunk ) continue;
        servicesJson += await decryptData( chunk, this.aesKeyHex );
      }

      this.services = JSON.parse( servicesJson );
      this.updateServicesList();
    } catch ( e ) {
      console.error( 'Failed to decrypt/parse services:', e );
      this.services = [];
      const keyStatusEl = document.getElementById( 'keyStatus' );
      keyStatusEl.textContent = 'Failed to decrypt services. Data may be corrupted.';
      keyStatusEl.className = 'error';
    }
  }

  /**
   * Retrieve the cached AES key from session storage via background script.
   * @returns {Promise<string|null>} Hex AES key or null
   */
  async getSessionKey () {
    return new Promise( ( resolve ) => {
      chrome.runtime.sendMessage( { type: 'getSessionKey' }, ( response ) => {
        resolve( response?.sessionKey || null );
      } );
    } );
  }

  /**
   * Get remaining minutes before session key expires.
   * @returns {Promise<number>} Minutes remaining, or 0
   */
  async getRemainingMinutes () {
    return new Promise( ( resolve ) => {
      chrome.runtime.sendMessage( { type: 'getRemainingMinutes' }, ( response ) => {
        resolve( response?.minutes || 0 );
      } );
    } );
  }

  /**
   * Save the AES key to session storage with a timeout.
   * @param {string} aesKeyHex - The AES key to cache
   * @param {number} minutes - Minutes until expiration
   */
  saveSessionKey ( aesKeyHex, minutes ) {
    chrome.runtime.sendMessage( {
      type: 'saveSessionKey',
      sessionKey: aesKeyHex,
      minutes: minutes
    } );
  }

  /** Clear the cached session key. */
  clearSessionKey () {
    chrome.runtime.sendMessage( { type: 'clearSessionKey' } );
  }

  /**
   * Format an expiration time for display.
   * @param {number} minutes - Minutes from now
   * @returns {string} Formatted expiration string
   */
  formatExpirationTime ( minutes ) {
    if ( minutes <= 0 ) return '';

    const expiresAt = new Date( Date.now() + minutes * 60 * 1000 );
    const year = expiresAt.getFullYear();
    const month = String( expiresAt.getMonth() + 1 ).padStart( 2, '0' );
    const day = String( expiresAt.getDate() ).padStart( 2, '0' );
    const hours = String( expiresAt.getHours() ).padStart( 2, '0' );
    const mins = String( expiresAt.getMinutes() ).padStart( 2, '0' );

    return `Expires: ${ year }-${ month }-${ day } ${ hours }:${ mins }`;
  }

  /**
   * Update the expiration time display element.
   * @param {number} minutes - Minutes remaining, 0 to hide
   */
  updateExpirationDisplay ( minutes ) {
    const expirationTimeEl = document.getElementById( 'expirationTime' );
    if ( minutes > 0 ) {
      expirationTimeEl.textContent = this.formatExpirationTime( minutes );
      expirationTimeEl.classList.remove( 'hidden' );
    } else {
      expirationTimeEl.textContent = '';
      expirationTimeEl.classList.add( 'hidden' );
    }
  }

  /**
   * Start refreshing the TOTP code for a selected service.
   * @param {number} serviceIndex - Index in the services array
   */
  startTokenRefresh ( serviceIndex ) {
    if ( this.currentTimer ) {
      clearInterval( this.currentTimer );
    }

    const updateToken = () => {
      const service = this.services[ serviceIndex ];
      const code = this.generateTOTP( service.secret );
      document.getElementById( 'totpCode' ).textContent = code;

      const secondsLeft = 30 - ( Math.floor( Date.now() / 1000 ) % 30 );
      document.getElementById( 'timeRemaining' ).textContent = `(${ secondsLeft }s)`;
    };

    updateToken();
    this.currentTimer = setInterval( updateToken, 1000 );
  }

  /** Populate the service select dropdown with sorted entries. */
  updateServicesList () {
    const select = document.getElementById( 'serviceSelect' );
    select.innerHTML = '<option value="">Select a service</option>';

    const opts = this.services.map( ( service, index ) => {
      return [ `${ service.name } (${ service.otp.label })`, index ];
    } );

    opts.sort( ( [ a ], [ b ] ) => a.localeCompare( b ) );

    opts.forEach( ( [ text, value ] ) => {
      const option = document.createElement( 'option' );
      option.value = value;
      option.textContent = text;
      select.appendChild( option );
    } );
  }

  /**
   * Generate a TOTP code for a given secret.
   * @param {string} secret - Base32-encoded TOTP secret
   * @returns {string} The TOTP code
   */
  generateTOTP ( secret ) {
    const epoch = Math.floor( Date.now() / 1000 );
    return this.totp.getOtp( secret, epoch );
  }

  /** Set up all DOM event listeners. */
  setupEventListeners () {
    // Session key persistence handler
    document.getElementById( 'persistMinutes' ).addEventListener( 'input', async ( e ) => {
      const minutes = parseInt( e.target.value ) || 0;

      if ( minutes > 0 && this.aesKeyHex && this.isUnlocked ) {
        await this.saveSessionKey( this.aesKeyHex, minutes );
        this.updateExpirationDisplay( minutes );
      } else {
        await this.clearSessionKey();
        this.updateExpirationDisplay( 0 );
      }
    } );

    // Import handler
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

    // Service selection handler
    document.getElementById( 'serviceSelect' ).addEventListener( 'change', ( e ) => {
      const totpContainer = document.querySelector( '.totpContainer' );
      const copyButton = document.getElementById( 'copyButton' );
      if ( e.target.value === '' ) {
        document.getElementById( 'totpCode' ).textContent = '';
        document.getElementById( 'timeRemaining' ).textContent = '';
        copyButton.classList.add( 'hidden' );
        totpContainer.classList.add( 'hidden' );
        if ( this.currentTimer ) {
          clearInterval( this.currentTimer );
          this.currentTimer = null;
        }
        return;
      }

      totpContainer.classList.remove( 'hidden' );
      copyButton.classList.remove( 'hidden' );
      this.startTokenRefresh( e.target.value );
    } );

    // Copy button handler
    document.getElementById( 'copyButton' ).addEventListener( 'click', () => {
      const code = document.getElementById( 'totpCode' ).textContent;
      if ( code ) navigator.clipboard.writeText( code );
    } );

    const handleSetKey = async () => {
      const password = document.getElementById( 'encryptionKey' ).value;
      if ( !password ) return;

      const isValid = await this.verifyKey( password );
      if ( isValid ) {
        await this.unlockApp( password );
      } else {
        const keyStatusEl = document.getElementById( 'keyStatus' );
        keyStatusEl.textContent = 'Invalid key';
        keyStatusEl.className = 'error';
      }
    };

    document.getElementById( 'encryptionKey' ).addEventListener( 'keypress', async ( e ) => {
      if ( e.key === 'Enter' ) {
        e.preventDefault();
        await handleSetKey();
      }
    } );

    document.getElementById( 'setKey' ).addEventListener( 'click', handleSetKey );

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
