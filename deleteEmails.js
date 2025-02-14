/**
 * Gmail Email Deletion Utility
 * 
 * This script processes Gmail messages before a specified date with options
 * to archive messages locally before deletion.
 * 
 * Usage:
 *   node deleteEmails.js [options]
 * 
 * Options:
 *   --before-date, -b  Target date for email deletion (YYYY-MM-DD)
 *                      Default: 2000-01-01
 * 
 *   --delete-only, -d  Skip local archiving of emails
 *                      Default: false (archiving enabled)
 * 
 * Examples:
 *   Delete emails before 2020-01-01 with archiving:
 *   > node deleteEmails.js --before-date 2020-01-01
 * 
 *   Delete emails before 2020-01-01 without archiving:
 *   > node deleteEmails.js -b 2020-01-01 --delete-only
 * 
 * Notes:
 *   - Archived emails are saved as JSON in ./email_archive/
 *   - Uses Gmail API batch operations (1000 emails per batch)
 *   - Includes rate limiting and quota management
 */

const fs = require('fs');
const express = require('express');
const { google } = require('googleapis');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const CREDENTIALS_PATH = 'credentials.json';
const TOKEN_PATH = 'token.json';
const PORT = 3000;

// Parse command-line arguments
const argv = yargs(hideBin(process.argv))
  .usage(`
Gmail Email Deletion Utility

Usage: $0 [options]

This script processes Gmail messages before a specified date with options
to archive messages locally before deletion.`)
  .option('before-date', {
    alias: 'b',
    type: 'string',
    description: 'Delete emails before this date (YYYY-MM-DD)',
    default: '2000-01-01',
    coerce: (arg) => {
      const date = new Date(arg);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date format. Use YYYY-MM-DD');
      }
      return arg;
    }
  })
  .option('delete-only', {
    alias: 'd',
    type: 'boolean',
    description: 'Skip local archiving of emails',
    default: false
  })
  .example('$0 -b 2020-01-01', 'Archive and delete emails before 2020-01-01')
  .example('$0 -b 2020-01-01 -d', 'Delete emails before 2020-01-01 (no archive)')
  .epilogue('Notes:\n' +
    '  - Archived emails are saved as JSON in ./email_archive/\n' +
    '  - Uses Gmail API batch operations (1000 emails per batch)\n' +
    '  - Includes rate limiting and quota management')
  .argv;




// Quota tracking metrics
const QUOTA_METRICS = {
  requestsPerDay: 0,
  requestsPerMin: 0,
  lastMinuteReset: Date.now(),
};

// Archive an email locally
async function archiveEmail(gmail, messageId, archiveFolder) {
  const message = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full'
  });
  
  const fileName = `${archiveFolder}/${messageId}.json`;
  fs.writeFileSync(fileName, JSON.stringify(message.data, null, 2));
}


// Track and update API usage metrics
function updateQuotaMetrics() {
  const now = Date.now();
  if (now - QUOTA_METRICS.lastMinuteReset >= 60000) {
    QUOTA_METRICS.requestsPerMin = 0;
    QUOTA_METRICS.lastMinuteReset = now;
  }
  QUOTA_METRICS.requestsPerDay++;
  QUOTA_METRICS.requestsPerMin++;
}

// Check if we're within quota limits
function canMakeRequest() {
  updateQuotaMetrics();
  return (
    QUOTA_METRICS.requestsPerDay < 1000000 && // Daily quota
    QUOTA_METRICS.requestsPerMin < 250 // Per-minute quota
  );
}

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
    `http://localhost:${PORT}/oauth2callback`
  );

  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://mail.google.com/'],
  });

  console.log('Authorize this app by visiting this URL:', authUrl);
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

// Optimized email deletion with parallel processing
async function deleteOldEmails(auth) {
  // Initialize Gmail API client
  const gmail = google.gmail({ version: 'v1', auth });
  
  // Configuration constants
  const date = argv['before-date'];  // Target date for email filtering
  const query = `before:${date}`;  // Gmail search query
  const archiveFolder = './email_archive';  // Local storage for email backups
  const BATCH_SIZE = 1000;  // Maximum messages per batch (Gmail API limit)

  // Create archive directory if archiving is enabled (default behavior)
  if (!argv['delete-only'] && !fs.existsSync(archiveFolder)) {
    fs.mkdirSync(archiveFolder);
  }

  // Initial status output
  console.log(`Searching for emails before ${date}...`);
  console.log(`Mode: ${argv['delete-only'] ? 'Delete Only' : 'Archive and Delete'}`);
  
  // Tracking variables
  let nextPageToken = null;  // Pagination token for Gmail API
  let totalDeleted = 0;      // Running count of processed emails
  let batchCount = 0;        // Number of batches processed

  try {
    // Main processing loop - continues until no more emails match criteria
    do {
      // Fetch batch of messages with quota-aware retry logic
      const res = await executeWithBackoff(() => 
        gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 1000,  // Match BATCH_SIZE for optimal processing
          pageToken: nextPageToken,
        })
      );

      // Extract messages and next page token
      const messages = res.data.messages || [];
      nextPageToken = res.data.nextPageToken;

      if (messages.length > 0) {
        // Archive phase - only if delete-only mode is not enabled
        if (!argv['delete-only']) {
          console.log(`Archiving batch ${batchCount + 1}...`);
          // Sequential processing of archives to prevent API overload
          for (const message of messages) {
            await executeWithBackoff(() => 
              archiveEmail(gmail, message.id, archiveFolder)
            );
          }
        }

        // Deletion phase
        const messageIds = messages.map(message => message.id);
        await executeWithBackoff(() =>
          gmail.users.messages.batchDelete({
            userId: 'me',
            requestBody: {
              ids: messageIds
            }
          })
        );
        
        // Update progress metrics
        totalDeleted += messageIds.length;
        batchCount++;
        
        // Progress reporting
        console.log(`Batch ${batchCount}: ${argv['delete-only'] ? '' : 'Archived and '}Deleted ${messageIds.length} emails`);
        console.log(`Running total: ${totalDeleted} emails processed`);
        
        // Rate limiting pause between batches
        await delay(20000);  // 20-second cooldown to prevent API rate limits
      }
    } while (nextPageToken);  // Continue while more pages exist

    // Final summary report
    console.log('\n=== Final Results ===');
    console.log(`Total batches processed: ${batchCount}`);
    console.log(`Total emails ${argv['delete-only'] ? '' : 'archived and '}deleted: ${totalDeleted}`);
  } catch (error) {
    console.error('Error processing emails:', error);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Exponential backoff implementation for API calls
async function executeWithBackoff(operation, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      if (!canMakeRequest()) {
        await delay(60000); // Wait if near quota limits
      }
      return await operation();
    } catch (error) {
      if (error.code === 429) {
        const waitTime = Math.pow(2, i) * 1000;
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
}
