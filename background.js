// background.js
let keepAlivePort = null;
let encryptionKey = null;

// Listen for port connections
chrome.runtime.onConnect.addListener( ( port ) => {
	if ( port.name === 'keepAlive' ) {
		keepAlivePort = port;
		port.onDisconnect.addListener( () => {
			keepAlivePort = null;
		} );
	}
} );

// Handle messages
chrome.runtime.onMessage.addListener( ( message, sender, sendResponse ) => {
	if ( message.type === 'importServices' ) {
		chrome.runtime.sendMessage( {
			type: 'servicesImported',
			services: message.services
		} );
		sendResponse( { status: 'success' } );
		return true;
	} else if ( message.type === 'setEncryptionKey' ) {
		encryptionKey = message.key;
		// Store key in local storage for persistence
		chrome.storage.local.set( { sessionKey: message.key } );
		sendResponse( { status: 'success' } );
		return true;
	} else if ( message.type === 'getEncryptionKey' ) {
		// First try to get from memory
		if ( encryptionKey ) {
			sendResponse( { key: encryptionKey } );
			return true;
		}
		// If not in memory, try to get from storage
		chrome.storage.local.get( 'sessionKey', ( result ) => {
			if ( result.sessionKey ) {
				encryptionKey = result.sessionKey;
			}
			sendResponse( { key: encryptionKey } );
		} );
		return true;
	} else if ( message.type === 'clearEncryptionKey' ) {
		encryptionKey = null;
		chrome.storage.local.remove( 'sessionKey' );
		sendResponse( { status: 'success' } );
		return true;
	}
	return false;
} );

// Clear encryption key when browser is closed or last window is closed
chrome.windows.onRemoved.addListener( () => {
	chrome.windows.getAll( {}, ( windows ) => {
		if ( windows.length === 0 ) {
			encryptionKey = null;
			chrome.storage.local.remove( 'sessionKey' );
		}
	} );
} );

// Handle extension startup, try to restore key from storage
chrome.runtime.onStartup.addListener( async () => {
	const result = await chrome.storage.local.get( 'sessionKey' );
	if ( result.sessionKey ) {
		encryptionKey = result.sessionKey;
	}
} );

// Handle extension install or update
chrome.runtime.onInstalled.addListener( () => {
	encryptionKey = null;
	chrome.storage.local.remove( 'sessionKey' );
} );