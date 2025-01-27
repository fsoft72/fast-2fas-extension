let keepAlivePort = null;

chrome.runtime.onConnect.addListener( ( port ) => {
	if ( port.name === 'keepAlive' ) {
		keepAlivePort = port;
		port.onDisconnect.addListener( () => {
			keepAlivePort = null;
		} );
	}
} );

chrome.runtime.onMessage.addListener( ( message, sender, sendResponse ) => {
	if ( message.type === 'importServices' ) {
		// Forward the imported services to the popup
		chrome.runtime.sendMessage( {
			type: 'servicesImported',
			services: message.services
		} );
		sendResponse( { status: 'success' } );
		return true;
	}
	return false;
} );