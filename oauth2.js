// oauth2.js
const { google } = require('googleapis');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

let savedTokens = null;

const scopes = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/analytics.edit'
];

function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
}

async function setCredentialsFromCode(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  savedTokens = tokens;
}

function getClient() {
  if (savedTokens) oauth2Client.setCredentials(savedTokens);
  return oauth2Client;
}

function isAuthenticated() {
  return !!savedTokens;
}

async function refreshIfNeeded() {
  if (!savedTokens?.refresh_token) return;
  oauth2Client.setCredentials(savedTokens);
  const { credentials } = await oauth2Client.refreshAccessToken();
  oauth2Client.setCredentials(credentials);
  savedTokens = credentials;
}

module.exports = {
  getAuthUrl,
  setCredentialsFromCode,
  getClient,
  isAuthenticated,
  refreshIfNeeded
};
