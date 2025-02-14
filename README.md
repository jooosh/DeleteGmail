Gmail Bulk Email Deletion Utility
=================================

Based on original work by [michaelndev913](https://github.com/michaelndev913/DeleteEmails)

A high-performance Node.js application that leverages the Gmail API to efficiently delete old emails. This utility uses Gmail's batch deletion capabilities to process up to 1000 emails per request while respecting API quotas.

Features
--------

-   Bulk deletion of emails before a specified date
-   OAuth2 authentication with Gmail
-   Automatic rate limiting and quota management
-   Optional local email archiving before deletion
-   Progress tracking and detailed logging

Prerequisites
-------------

-   Node.js installed on your system
-   A Google Cloud Project with Gmail API enabled
-   OAuth 2.0 credentials configured for desktop application

Installation
------------

1.  Clone the repository: git clone https://github.com/yourusername/gmail-cleanup

2.  Install dependencies: cd gmail-cleanup pnpm install

Gmail API Authorization Setup
-----------------------------

1.  Go to [Google Cloud Console](https://console.cloud.google.com)

2.  Create a new project or select an existing one

3.  Enable the Gmail API:

    -   Navigate to "APIs & Services" > "Library"
    -   Search for "Gmail API"
    -   Click "Enable"
4.  Configure OAuth consent screen:

    -   Go to "APIs & Services" > "OAuth consent screen"
    -   Select "External" user type
    -   Fill in required application information
    -   Add "https://mail.google.com/" to the scopes
    -   Add your email as a test user
5.  Create OAuth credentials:

    -   Go to "APIs & Services" > "Credentials"
    -   Click "Create Credentials" > "OAuth client ID"
    -   Choose "Desktop app" as application type
    -   Name your OAuth 2.0 client
    -   Download the client configuration file
    -   Rename the downloaded file to `credentials.json`
    -   Place `credentials.json` in your project root directory

Usage
-----

Run the script: node deleteEmails.js

On first run:

1.  Script will provide a URL for Gmail authorization
2.  Open the URL in your browser
3.  Select your Google account and grant permissions
4.  Authorization complete when you see "You can close this tab"

The script will:

-   Process emails in batches of 1000 (Gmail API maximum)
-   Show real-time deletion progress
-   Display running totals of deleted emails
-   Maintain operation within Gmail's quota limits

Configuration Options
---------------------

Edit `deleteEmails.js` to modify:

-   Target date for email deletion
-   Batch processing parameters
-   Archive settings (enable/disable)
-   Delay between batches

Technical Details
-----------------

-   Uses Gmail API batch deletion endpoint
-   Implements exponential backoff for API errors
-   Monitors and respects API quotas:
    -   1,000,000 queries per day
    -   250 queries per minute
-   Processes up to 1000 emails per batch request

Dependencies
------------

-   googleapis
-   express
-   fs (Node.js built-in)

Notes
-----

-   The script requires full Gmail access to perform deletions
-   Initial authorization token is stored in `token.json`
-   Progress is displayed in real-time via console
-   Maintains high performance while staying within API limits

Credits
-------

This project is an enhanced version of the original Gmail deletion tool created by [michaelndev913](https://github.com/michaelndev913/DeleteEmails). Enhancements include:

-   Batch deletion support (up to 1000 emails per request)
-   Improved quota management
-   Real-time progress tracking
-   Enhanced error handling
-   Detailed documentation
