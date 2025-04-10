// background.js
let keepAlivePort = null;

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
	}
	// Removed setEncryptionKey and getEncryptionKey handlers
	return false;
} );

// Clear encryption key when browser is closed or last window is closed
chrome.windows.onRemoved.addListener( () => {
	chrome.windows.getAll( {}, ( windows ) => {
		if ( windows.length === 0 ) {
			encryptionKey = null;
		}
	} );
} );

// Handle extension startup, reset key
chrome.runtime.onStartup.addListener( () => {
	encryptionKey = null;
} );

// Handle extension install or update
chrome.runtime.onInstalled.addListener( () => {
	encryptionKey = null;
} );