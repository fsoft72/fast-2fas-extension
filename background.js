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

// Removed listeners that cleared the encryptionKey
