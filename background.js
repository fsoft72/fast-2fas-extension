// background.js

// Password persistence keys for chrome.storage.session
const SESSION_KEY_PASSWORD = 'savedPassword';
const SESSION_KEY_EXPIRES_AT = 'passwordExpiresAt';

/**
 * Retrieve saved password from session storage, checking expiration.
 * Returns the password if still valid, null otherwise.
 */
const getSavedPassword = async () => {
	const data = await chrome.storage.session.get( [ SESSION_KEY_PASSWORD, SESSION_KEY_EXPIRES_AT ] );
	const password = data[ SESSION_KEY_PASSWORD ] || null;
	const expiresAt = data[ SESSION_KEY_EXPIRES_AT ] || null;

	if ( !password ) return null;

	// Check if expired
	if ( expiresAt && Date.now() >= expiresAt ) {
		await clearSavedPassword();
		return null;
	}

	return password;
};

/**
 * Save password to session storage with an expiration timestamp.
 */
const savePassword = async ( password, minutes ) => {
	const data = { [ SESSION_KEY_PASSWORD ]: password };

	if ( minutes > 0 ) {
		data[ SESSION_KEY_EXPIRES_AT ] = Date.now() + ( minutes * 60 * 1000 );
	} else {
		data[ SESSION_KEY_EXPIRES_AT ] = null;
	}

	await chrome.storage.session.set( data );
};

/**
 * Clear saved password and expiration from session storage.
 */
const clearSavedPassword = async () => {
	await chrome.storage.session.remove( [ SESSION_KEY_PASSWORD, SESSION_KEY_EXPIRES_AT ] );
};

/**
 * Get remaining minutes before password expires.
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
	if ( message.type === 'importServices' ) {
		chrome.runtime.sendMessage( {
			type: 'servicesImported',
			services: message.services
		} );
		sendResponse( { status: 'success' } );
		return true;
	}

	if ( message.type === 'savePassword' ) {
		savePassword( message.password, message.minutes || 0 ).then( () => {
			sendResponse( { status: 'success' } );
		} );
		return true;
	}

	if ( message.type === 'getPassword' ) {
		getSavedPassword().then( ( password ) => {
			sendResponse( { password } );
		} );
		return true;
	}

	if ( message.type === 'clearPassword' ) {
		clearSavedPassword().then( () => {
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

// Clear password when browser is closed (last window removed)
chrome.windows.onRemoved.addListener( () => {
	chrome.windows.getAll( {}, ( windows ) => {
		if ( windows.length === 0 ) {
			clearSavedPassword();
		}
	} );
} );

// Handle extension startup - clear password for fresh browser session
chrome.runtime.onStartup.addListener( () => {
	clearSavedPassword();
} );

// Handle extension install or update
chrome.runtime.onInstalled.addListener( () => {
	clearSavedPassword();
} );