document.addEventListener( 'DOMContentLoaded', () => {
	const importButton = document.getElementById( 'importButton' );
	const fileInput = document.getElementById( 'importFile' );
	const statusDiv = document.getElementById( 'status' );

	importButton.addEventListener( 'click', async () => {
		const file = fileInput.files[ 0 ];
		if ( !file ) {
			statusDiv.textContent = 'Please select a file first';
			return;
		}

		importButton.disabled = true;
		importButton.textContent = 'Importing...';
		statusDiv.textContent = 'Processing...';

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

			// Send the data to the extension
			await chrome.runtime.sendMessage( {
				type: 'importServices',
				services: importedData.services
			} );

			statusDiv.textContent = 'Import successful! You can close this window.';
			setTimeout( () => window.close(), 2000 );

		} catch ( error ) {
			console.error( 'Import failed:', error );
			statusDiv.textContent = 'Failed to import: ' + error.message;
		} finally {
			importButton.disabled = false;
			importButton.textContent = 'Import Services';
		}
	} );
} );