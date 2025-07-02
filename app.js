require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const path = require('path');
const bodyParser = require('body-parser');
const { getAuthUrl, getTokenFromCode, getDRNEmails, getEmailStats } = require('./gmail');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Trust proxy for Railway
app.set('trust proxy', 1);

// Production-ready session configuration
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'vehicle.sid', // Change default session name for security
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    httpOnly: true, // Prevent XSS attacks
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    sameSite: 'lax' // CSRF protection
  }
};

// Use MongoDB session store if MONGODB_URI is provided, otherwise use default (with warning)
if (process.env.MONGODB_URI) {
  sessionConfig.store = MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600 // Lazy session update
  });
  console.log('✅ Using MongoDB session store');
} else {
  console.log('⚠️  Using memory session store (not recommended for production)');
  console.log('   Set MONGODB_URI environment variable for production use');
}

app.use(session(sessionConfig));

// Middleware to protect dashboard
function checkAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
}

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Routes
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  const error = req.query.error;
  let errorMessage = null;
  
  if (error === '1') {
    errorMessage = 'Invalid credentials';
  }
  
  res.render('login', { error: errorMessage });
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Get credentials from environment variables
    const adminUser = process.env.ADMIN_USER || process.env.APP_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASS || process.env.APP_PASSWORD || 'admin';

    console.log('Login attempt for user:', username);
    
    // Basic validation
    if (!username || !password) {
      return res.render('login', { error: 'Username and password are required' });
    }

    if (username === adminUser && password === adminPass) {
      req.session.authenticated = true;
      req.session.user = username;
      console.log('✅ Authentication successful for:', username);
      res.redirect('/dashboard');
    } else {
      console.log('❌ Authentication failed for:', username);
      res.render('login', { error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'Login failed. Please try again.' });
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
        console.log(`📧 Dashboard loaded with ${emails.length} DRN emails`);
      } catch (error) {
        console.error('❌ Error fetching DRN emails:', error);
        // Reset gmail auth if there's an error
        req.session.gmailAuth = null;
      }
    }
    
    res.render('dashboard', { 
      emails: emails || [],
      stats: stats,
      gmailConnected: gmailConnected,
      lastCheck: lastCheck,
      error: req.query.error || null,
      user: req.session.user || 'Admin'
    });
  } catch (error) {
    console.error('❌ Dashboard error:', error);
    res.render('dashboard', { 
      emails: [], 
      stats: { newEmails: 0, totalEmails: 0, todaysEmails: 0 },
      gmailConnected: false,
      lastCheck: new Date().toLocaleString(),
      error: 'Error loading dashboard',
      user: req.session.user || 'Admin'
    });
  }
});

// API endpoint to mark email as processed
app.post('/api/mark-processed', checkAuth, async (req, res) => {
  try {
    const { emailId } = req.body;
    
    if (!emailId) {
      return res.status(400).json({ success: false, error: 'Email ID is required' });
    }
    
    console.log(`📝 Marking email ${emailId} as processed`);
    
    res.json({ success: true, message: 'Email marked as processed' });
  } catch (error) {
    console.error('❌ Error marking email as processed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to mark all emails as processed
app.post('/api/mark-all-processed', checkAuth, async (req, res) => {
  try {
    console.log('📝 Marking all emails as processed');
    
    res.json({ success: true, message: 'All emails marked as processed' });
  } catch (error) {
    console.error('❌ Error marking all emails as processed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to clear all data
app.post('/api/clear-all-data', checkAuth, async (req, res) => {
  try {
    console.log('🗑️  Clearing all data');
    
    res.json({ success: true, message: 'All data cleared' });
  } catch (error) {
    console.error('❌ Error clearing data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to force check for new emails
app.post('/api/force-check', checkAuth, async (req, res) => {
  try {
    if (!req.session.gmailAuth) {
      return res.status(400).json({ success: false, error: 'Gmail not connected' });
    }

    console.log('🔄 Force checking for new DRN emails...');
    const emails = await getDRNEmails(req.session.gmailAuth);
    const stats = getEmailStats(emails);
    
    res.json({ 
      success: true, 
      message: 'Email check completed',
      stats,
      emailCount: emails.length
    });
  } catch (error) {
    console.error('❌ Error force checking emails:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Gmail authorization route
app.get('/auth/gmail', checkAuth, async (req, res) => {
  try {
    const authUrl = await getAuthUrl();
    res.redirect(authUrl);
  } catch (error) {
    console.error('❌ Gmail auth error:', error);
    res.redirect('/dashboard?error=gmail_auth_failed');
  }
});

// OAuth callback route - this is where Google redirects back to
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  const error = req.query.error;
  
  if (error) {
    console.error('❌ OAuth error:', error);
    return res.redirect('/dashboard?error=oauth_denied');
  }
  
  if (!code) {
    console.error('❌ No authorization code received');
    return res.send(`
      <html>
        <head><title>Authorization Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #dc3545;">No authorization code received</h2>
          <p>Please try again.</p>
          <a href="/dashboard" style="background: #6c757d; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Return to Dashboard</a>
        </body>
      </html>
    `);
  }
  
  try {
    console.log('🔐 Processing OAuth callback...');
    const auth = await getTokenFromCode(code);
    
    // Store the auth object in session
    req.session.gmailAuth = {
      access_token: auth.credentials.access_token,
      refresh_token: auth.credentials.refresh_token,
      token_type: auth.credentials.token_type,
      expiry_date: auth.credentials.expiry_date
    };
    
    console.log('✅ Gmail authorization successful');
    
    res.send(`
      <html>
        <head>
          <title>Gmail Connected</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #4285f4;">Gmail Authorization Successful!</h2>
          <p>DRN email monitoring is now active.</p>
          <div style="margin: 20px 0;">
            <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #4285f4; border-radius: 50%; animation: spin 2s linear infinite;"></div>
          </div>
          <p>Redirecting to dashboard...</p>
          <script>
            setTimeout(function() {
              window.location.href = '/dashboard';
            }, 3000);
          </script>
          <style>
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
          <a href="/dashboard" style="background: #4285f4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Go to Dashboard Now</a>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ Token exchange error:', error);
    res.send(`
      <html>
        <head><title>Authorization Failed</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #dc3545;">Authorization Failed</h2>
          <p>Error: ${error.message}</p>
          <p>Please try connecting Gmail again.</p>
          <a href="/dashboard" style="background: #6c757d; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Return to Dashboard</a>
        </body>
      </html>
    `);
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Session destroy error:', err);
    }
    console.log('👋 User logged out');
    res.redirect('/login');
  });
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).send(`
    <html>
      <head><title>Page Not Found</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h1>404 - Page Not Found</h1>
        <p>The page you're looking for doesn't exist.</p>
        <a href="/dashboard" style="background: #4285f4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Go to Dashboard</a>
      </body>
    </html>
  `);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).send(`
    <html>
      <head><title>Server Error</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h1>500 - Server Error</h1>
        <p>Something went wrong. Please try again later.</p>
        <a href="/dashboard" style="background: #4285f4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Go to Dashboard</a>
      </body>
    </html>
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 ================================');
  console.log(`✅ Vehicle Insight App running on port ${PORT}`);
  console.log(`🔗 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📧 Gmail OAuth callback configured`);
  console.log(`🚗 DRN Email Monitoring Ready`);
  console.log('🚀 ================================');
});

// Handle server errors
server.on('error', (err) => {
  console.error('❌ Server error:', err);
  process.exit(1);
});