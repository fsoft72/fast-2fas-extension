/**
 * PBKDF2 key derivation and AES-256-GCM encryption utilities.
 * Uses WebCrypto API for all cryptographic operations.
 */

const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTE_LENGTH = 16;

/**
 * Convert a Uint8Array buffer to a hex string.
 * @param {Uint8Array} buffer - The buffer to convert
 * @returns {string} Hex-encoded string
 */
const bufferToHex = ( buffer ) => {
  return Array.from( new Uint8Array( buffer ) )
    .map( b => b.toString( 16 ).padStart( 2, '0' ) )
    .join( '' );
};

/**
 * Convert a hex string to a Uint8Array buffer.
 * @param {string} hex - Hex-encoded string
 * @returns {Uint8Array} The decoded buffer
 */
const hexToBuffer = ( hex ) => {
  return new Uint8Array( hex.match( /.{2}/g ).map( byte => parseInt( byte, 16 ) ) );
};

/**
 * Generate a random salt as a hex string.
 * @returns {string} 32-char hex string (16 bytes)
 */
const generateSalt = () => {
  const buffer = new Uint8Array( SALT_BYTE_LENGTH );
  crypto.getRandomValues( buffer );
  return bufferToHex( buffer );
};

/**
 * Derive a verification hash and AES key from a password and salt using PBKDF2.
 * Produces 512 bits: first 256 bits for verification, last 256 bits as the AES-GCM key.
 * @param {string} password - The user's password
 * @param {string} saltHex - Hex-encoded salt
 * @returns {Promise<{verifyHash: string, aesKeyHex: string}>} Derived key pair
 */
const deriveKeys = async ( password, saltHex ) => {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode( password ),
    'PBKDF2',
    false,
    [ 'deriveBits' ]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBuffer( saltHex ),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    512
  );

  const derivedArray = new Uint8Array( derivedBits );
  const verifyHash = bufferToHex( derivedArray.slice( 0, 32 ) );
  const aesKeyHex = bufferToHex( derivedArray.slice( 32, 64 ) );

  return { verifyHash, aesKeyHex };
};

/**
 * Encrypt data using AES-256-GCM.
 * @param {*} data - Data to encrypt (will be JSON-serialized)
 * @param {string} aesKeyHex - 64-char hex AES key
 * @returns {Promise<{iv: string, data: string}>} Encrypted payload as hex strings
 */
const encryptData = async ( data, aesKeyHex ) => {
  const iv = crypto.getRandomValues( new Uint8Array( 12 ) );
  const encoder = new TextEncoder();
  const keyBuffer = await crypto.subtle.importKey(
    'raw',
    hexToBuffer( aesKeyHex ),
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
    iv: bufferToHex( iv ),
    data: bufferToHex( new Uint8Array( encrypted ) )
  };
};

/**
 * Decrypt data using AES-256-GCM.
 * @param {{iv: string, data: string}} encrypted - Encrypted payload with hex-encoded iv and data
 * @param {string} aesKeyHex - 64-char hex AES key
 * @returns {Promise<*>} Decrypted and JSON-parsed data
 */
const decryptData = async ( encrypted, aesKeyHex ) => {
  const keyBuffer = await crypto.subtle.importKey(
    'raw',
    hexToBuffer( aesKeyHex ),
    { name: 'AES-GCM' },
    false,
    [ 'decrypt' ]
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: hexToBuffer( encrypted.iv )
    },
    keyBuffer,
    hexToBuffer( encrypted.data )
  );

  return JSON.parse( new TextDecoder().decode( decrypted ) );
};
