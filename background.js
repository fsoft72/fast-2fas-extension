// background.js

// Session key persistence keys for chrome.storage.session
const SESSION_KEY_AES = 'sessionAesKey';
const SESSION_KEY_EXPIRES_AT = 'passwordExpiresAt';

/**
 * Retrieve cached AES key from session storage, checking expiration.
 * Returns the key if still valid, null otherwise.
 */
const getSessionKey = async () => {
	const data = await chrome.storage.session.get( [ SESSION_KEY_AES, SESSION_KEY_EXPIRES_AT ] );
	const sessionKey = data[ SESSION_KEY_AES ] || null;
	const expiresAt = data[ SESSION_KEY_EXPIRES_AT ] || null;

	if ( !sessionKey ) return null;

	// Check if expired
	if ( expiresAt && Date.now() >= expiresAt ) {
		await clearSessionKey();
		return null;
	}

	return sessionKey;
};

/**
 * Save AES key to session storage with an expiration timestamp.
 */
const saveSessionKey = async ( sessionKey, minutes ) => {
	const data = { [ SESSION_KEY_AES ]: sessionKey };

	if ( minutes > 0 ) {
		data[ SESSION_KEY_EXPIRES_AT ] = Date.now() + ( minutes * 60 * 1000 );
	} else {
		data[ SESSION_KEY_EXPIRES_AT ] = null;
	}

	await chrome.storage.session.set( data );
};

/**
 * Clear cached session key and expiration from session storage.
 */
const clearSessionKey = async () => {
	await chrome.storage.session.remove( [ SESSION_KEY_AES, SESSION_KEY_EXPIRES_AT ] );
};

/**
 * Get remaining minutes before session key expires.
 * Returns 0 if no expiration is set or already expired.
 */
const getRemainingMinutes = async () => {
	const data = await chrome.storage.session.get( SESSION_KEY_EXPIRES_AT );
	const expiresAt = data[ SESSION_KEY_EXPIRES_AT ] || null;

	if ( !expiresAt ) return 0;

	const remainingMs = expiresAt - Date.now();
	const minutes = Math.ceil( remainingMs / ( 60 * 1000 ) );
	return minutes > 0 ? minutes : 0;
};

// Handle messages
chrome.runtime.onMessage.addListener( ( message, sender, sendResponse ) => {
	// Reject messages from other extensions or content scripts
	if ( sender.id !== chrome.runtime.id ) return false;

	if ( message.type === 'importServices' ) {
		chrome.runtime.sendMessage( {
			type: 'servicesImported',
			services: message.services
		} );
		sendResponse( { status: 'success' } );
		return true;
	}

	if ( message.type === 'saveSessionKey' ) {
		saveSessionKey( message.sessionKey, message.minutes || 0 ).then( () => {
			sendResponse( { status: 'success' } );
		} );
		return true;
	}

	if ( message.type === 'getSessionKey' ) {
		getSessionKey().then( ( sessionKey ) => {
			sendResponse( { sessionKey } );
		} );
		return true;
	}

	if ( message.type === 'clearSessionKey' ) {
		clearSessionKey().then( () => {
			sendResponse( { status: 'success' } );
		} );
		return true;
	}

	if ( message.type === 'getRemainingMinutes' ) {
		getRemainingMinutes().then( ( minutes ) => {
			sendResponse( { minutes } );
		} );
		return true;
	}

	return false;
} );

// Clear session key when browser is closed (last window removed)
chrome.windows.onRemoved.addListener( () => {
	chrome.windows.getAll( {}, ( windows ) => {
		if ( windows.length === 0 ) {
			clearSessionKey();
		}
	} );
} );

// Handle extension startup - clear session key for fresh browser session
chrome.runtime.onStartup.addListener( () => {
	clearSessionKey();
} );

// Handle extension install or update
chrome.runtime.onInstalled.addListener( () => {
	clearSessionKey();
} );
