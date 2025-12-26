// background.js
let keepAlivePort = null;

// Password persistence variables
let savedPassword = null;
let passwordTimeout = null;
let passwordExpiresAt = null;

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

	if ( message.type === 'savePassword' ) {
		// Clear existing timeout if any
		if ( passwordTimeout ) {
			clearTimeout( passwordTimeout );
		}

		// Save the password
		savedPassword = message.password;
		const minutes = message.minutes || 0;

		if ( minutes > 0 ) {
			// Set expiration time
			passwordExpiresAt = Date.now() + ( minutes * 60 * 1000 );

			// Set timeout to clear password
			passwordTimeout = setTimeout( () => {
				savedPassword = null;
				passwordTimeout = null;
				passwordExpiresAt = null;
			}, minutes * 60 * 1000 );
		} else {
			passwordExpiresAt = null;
		}

		sendResponse( { status: 'success' } );
		return true;
	}

	if ( message.type === 'getPassword' ) {
		sendResponse( { password: savedPassword } );
		return true;
	}

	if ( message.type === 'clearPassword' ) {
		if ( passwordTimeout ) {
			clearTimeout( passwordTimeout );
		}
		savedPassword = null;
		passwordTimeout = null;
		passwordExpiresAt = null;
		sendResponse( { status: 'success' } );
		return true;
	}

	if ( message.type === 'getRemainingMinutes' ) {
		let remainingMinutes = 0;
		if ( passwordExpiresAt ) {
			const remainingMs = passwordExpiresAt - Date.now();
			remainingMinutes = Math.ceil( remainingMs / ( 60 * 1000 ) );
			if ( remainingMinutes < 0 ) remainingMinutes = 0;
		}
		sendResponse( { minutes: remainingMinutes } );
		return true;
	}

	// Removed setEncryptionKey and getEncryptionKey handlers
	return false;
} );

// Clear password when browser is closed or last window is closed
chrome.windows.onRemoved.addListener( () => {
	chrome.windows.getAll( {}, ( windows ) => {
		if ( windows.length === 0 ) {
			if ( passwordTimeout ) {
				clearTimeout( passwordTimeout );
			}
			savedPassword = null;
			passwordTimeout = null;
			passwordExpiresAt = null;
		}
	} );
} );

// Handle extension startup, reset password
chrome.runtime.onStartup.addListener( () => {
	if ( passwordTimeout ) {
		clearTimeout( passwordTimeout );
	}
	savedPassword = null;
	passwordTimeout = null;
	passwordExpiresAt = null;
} );

// Handle extension install or update
chrome.runtime.onInstalled.addListener( () => {
	if ( passwordTimeout ) {
		clearTimeout( passwordTimeout );
	}
	savedPassword = null;
	passwordTimeout = null;
	passwordExpiresAt = null;
} );