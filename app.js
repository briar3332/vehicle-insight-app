require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const bodyParser = require('body-parser');
const { getAuthUrl, getTokenFromCode, getDRNEmails, getEmailStats } = require('./gmail');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); // Add JSON parsing for API endpoints
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS in production
}));

// Middleware to protect dashboard
function checkAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
}

// Routes
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.APP_USERNAME;  // Fixed: Using APP_USERNAME
  const adminPass = process.env.APP_PASSWORD;  // Fixed: Using APP_PASSWORD

  console.log('Login attempt:', { username, password });
  console.log('Expected:', { adminUser, adminPass });

  if (username === adminUser && password === adminPass) {
    req.session.authenticated = true;
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'Invalid credentials' });
  }
});

app.get('/dashboard', checkAuth, async (req, res) => {
  try {
    let emails = [];
    let stats = { newEmails: 0, totalEmails: 0, todaysEmails: 0 };
    let gmailConnected = false;
    let lastCheck = new Date().toLocaleString();
    
    if (req.session.gmailAuth) {
      try {
        emails = await getDRNEmails(req.session.gmailAuth);
        stats = getEmailStats(emails);
        gmailConnected = true;
        console.log(`Dashboard loaded with ${emails.length} DRN emails`);
      } catch (error) {
        console.error('Error fetching DRN emails:', error);
        // Reset gmail auth if there's an error
        req.session.gmailAuth = null;
      }
    }
    
    res.render('dashboard', { 
      emails: emails || [],
      stats: stats,
      gmailConnected: gmailConnected,
      lastCheck: lastCheck,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('dashboard', { 
      emails: [], 
      stats: { newEmails: 0, totalEmails: 0, todaysEmails: 0 },
      gmailConnected: false,
      lastCheck: new Date().toLocaleString(),
      error: 'Error loading dashboard'
    });
  }
});

// API endpoint to mark email as processed
app.post('/api/mark-processed', checkAuth, async (req, res) => {
  try {
    const { emailId } = req.body;
    
    // In a real app, you'd update this in a database
    // For now, we'll just return success
    console.log(`Marking email ${emailId} as processed`);
    
    res.json({ success: true, message: 'Email marked as processed' });
  } catch (error) {
    console.error('Error marking email as processed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to mark all emails as processed
app.post('/api/mark-all-processed', checkAuth, async (req, res) => {
  try {
    console.log('Marking all emails as processed');
    
    // In a real app, you'd update all emails in database
    res.json({ success: true, message: 'All emails marked as processed' });
  } catch (error) {
    console.error('Error marking all emails as processed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to clear all data
app.post('/api/clear-all-data', checkAuth, async (req, res) => {
  try {
    console.log('Clearing all data');
    
    // In a real app, you'd clear the database
    res.json({ success: true, message: 'All data cleared' });
  } catch (error) {
    console.error('Error clearing data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to force check for new emails
app.post('/api/force-check', checkAuth, async (req, res) => {
  try {
    if (!req.session.gmailAuth) {
      return res.status(400).json({ success: false, error: 'Gmail not connected' });
    }

    console.log('Force checking for new DRN emails...');
    const emails = await getDRNEmails(req.session.gmailAuth);
    const stats = getEmailStats(emails);
    
    res.json({ 
      success: true, 
      message: 'Email check completed',
      stats,
      emailCount: emails.length
    });
  } catch (error) {
    console.error('Error force checking emails:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Gmail authorization route
app.get('/auth/gmail', checkAuth, async (req, res) => {
  try {
    const authUrl = await getAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    console.error('Gmail auth error:', error);
    res.redirect('/dashboard?error=gmail_auth_failed');
  }
});

// OAuth callback route - this is where Google redirects back to
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  const error = req.query.error;
  
  if (error) {
    console.error('OAuth error:', error);
    return res.redirect('/dashboard?error=oauth_denied');
  }
  
  if (!code) {
    console.error('No authorization code received');
    return res.send(`
      <html>
        <body>
          <h2>No authorization code received</h2>
          <p>Please try again.</p>
          <a href="/dashboard">Return to Dashboard</a>
        </body>
      </html>
    `);
  }
  
  try {
    console.log('Processing OAuth callback with code:', code.substring(0, 20) + '...');
    const auth = await getTokenFromCode(code);
    
    // Store the auth object in session
    req.session.gmailAuth = {
      access_token: auth.credentials.access_token,
      refresh_token: auth.credentials.refresh_token,
      token_type: auth.credentials.token_type,
      expiry_date: auth.credentials.expiry_date
    };
    
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #4285f4;">Gmail Authorization Successful!</h2>
          <p>DRN email monitoring is now active.</p>
          <script>
            setTimeout(function() {
              window.location.href = '/dashboard';
            }, 2000);
          </script>
          <a href="/dashboard" style="background: #4285f4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Return to Dashboard</a>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Token exchange error:', error);
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #dc3545;">Authorization Failed</h2>
          <p>Error: ${error.message}</p>
          <a href="/dashboard" style="background: #6c757d; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Return to Dashboard</a>
        </body>
      </html>
    `);
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
    }
    res.redirect('/login');
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Vehicle Insight App running on port ${PORT}`);
  console.log(`🔗 Local: http://localhost:${PORT}`);
  console.log(`📧 Gmail OAuth callback: http://localhost:${PORT}/oauth2callback`);
  console.log(`🚗 DRN Email Monitoring Active`);
});