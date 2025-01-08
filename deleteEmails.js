const fs = require('fs');
const express = require('express');
const { google } = require('googleapis');

const CREDENTIALS_PATH = 'credentials.json';
const TOKEN_PATH = 'token.json';
const PORT = 3000; // Localhost port for OAuth2 callback

// Load client secrets from a local file
fs.readFile(CREDENTIALS_PATH, (err, content) => {
  if (err) return console.error('Error loading client secret file:', err);
  authorize(JSON.parse(content), deleteOldEmails);
});

// Authorize a client with credentials
function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    `http://localhost:${PORT}/oauth2callback` // Redirect URI
  );

  // Check if we have a previously stored token
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

// Get a new token if none is available
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://mail.google.com/'], // Full Gmail access scope
  });

  console.log('Authorize this app by visiting this URL:', authUrl);

  // Set up an Express server to handle the redirect
  const app = express();

  app.get('/oauth2callback', (req, res) => {
    const code = req.query.code;
    if (!code) {
      res.send('Error: Authorization code not found.');
      return;
    }

    oAuth2Client.getToken(code, (err, token) => {
      if (err) {
        console.error('Error retrieving access token:', err);
        res.send('Error retrieving access token.');
        return;
      }

      oAuth2Client.setCredentials(token);

      // Store the token for future use
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });

      res.send('Authorization successful! You can close this tab.');
      callback(oAuth2Client);
    });
  });

  app.listen(PORT, () => {
    console.log(`Express server listening on http://localhost:${PORT}`);
  });
}

// Function to delete emails older than the specified date
async function deleteOldEmails(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  const date = '2022-01-01'; // Replace with your input date (YYYY-MM-DD format)
  const query = `before:${date}`;
  const archiveFolder = './email_archive'; // Folder to save archived emails

  // Ensure the archive folder exists
  if (!fs.existsSync(archiveFolder)) {
    fs.mkdirSync(archiveFolder);
  }

  console.log(`Searching for emails before ${date}...`);
  let nextPageToken = null;
  let totalDeleted = 0;
  let totalArchived = 0;

  try {
    do {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 10000, // Gmail API limit
        pageToken: nextPageToken, // Fetch next page
      });

      const messages = res.data.messages || [];
      nextPageToken = res.data.nextPageToken;

      if (messages.length > 0) {
        for (const message of messages) {
          try {
            // Fetch the full email
            const emailRes = await gmail.users.messages.get({
              userId: 'me',
              id: message.id,
              format: 'raw', // Fetch raw email content
            });

            // Save the email locally as a .eml file
            const emailData = emailRes.data.raw;
            const emailBuffer = Buffer.from(emailData, 'base64');
            const filePath = `${archiveFolder}/${message.id}.eml`;
            fs.writeFileSync(filePath, emailBuffer);
            console.log(`Archived email with ID: ${message.id} to ${filePath}`);
            totalArchived++;

            // Delete the email
            await gmail.users.messages.delete({
              userId: 'me',
              id: message.id,
            });
            console.log(`Deleted email with ID: ${message.id}`);
            totalDeleted++;
          } catch (archiveOrDeleteError) {
            console.error(
              `Error archiving or deleting email with ID: ${message.id}`,
              archiveOrDeleteError
            );
          }
        }
        console.log(`Processed ${messages.length} emails in this batch.`);
      }
    } while (nextPageToken);

    console.log(`Total emails archived: ${totalArchived}`);
    console.log(`Total emails deleted: ${totalDeleted}`);
  } catch (error) {
    console.error('Error processing emails:', error);
  }
}
