// ============================================
// SINGULAR → MIXPANEL ATTRIBUTION INTEGRATION
// Clean version with minimal logging
// ============================================

const https = require('https');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  MIXPANEL_TOKEN: process.env.MIXPANEL_TOKEN,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000
};

// ============================================
// FIELD MAPPING
// ============================================

const FIELD_MAPPING = {
  // Singular field names
  campaign: 'mp_campaign',
  network: 'mp_source',
  site: 'mp_site',
  tracker_name: 'mp_tracker',
  aifa: 'idfa',
  idfa: 'idfa',
  idfv: 'idfv',
  gaid: 'gaid',
  platform: 'platform',
  os_version: 'os_version',
  device_brand: 'device_brand',
  device_model: 'device_model',
  city: 'city',
  country: 'country',
  app_name: 'app_name',
  app_version: 'app_version'
};

// Event name mapping
const EVENT_MAPPING = {
  '__start__': {
    install: 'install',           // is_reengagement = 0
    reengagement: 'reengagement'  // is_reengagement = 1
  },
  'login_completed_event': 'attribution_received'
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function getDistinctId(payload) {
  return payload.user_id 
    || payload.aifa 
    || payload.idfa 
    || payload.gaid 
    || payload.idfv 
    || null;
}

function getEventName(payload) {
  const eventName = (payload.event_name || '').toLowerCase();
  
  // Handle __START__ event
  if (eventName === '__start__') {
    return payload.is_reengagement === 1 ? 'reengagement' : 'install';
  }
  
  // Handle login_completed_event → attribution_received
  if (payload.event_name === 'login_completed_event') {
    return 'attribution_received';
  }
  
  // Return original event name for other events
  return payload.event_name || 'unknown_event';
}

function mapFields(payload) {
  const props = {};
  
  // Map standard fields
  for (const [singularField, mixpanelField] of Object.entries(FIELD_MAPPING)) {
    if (payload[singularField] !== undefined && payload[singularField] !== null) {
      props[mixpanelField] = payload[singularField];
    }
  }
  
  // Convert timestamp
  if (payload.install_utc_timestamp) {
    props.install_time = new Date(payload.install_utc_timestamp * 1000).toISOString();
  }
  
  // Convert touch type
  if (payload.is_viewthrough !== undefined) {
    props.attribution_touch = payload.is_viewthrough === 1 ? 'view' : 'click';
  }
  
  // Add extra fields
  for (const [key, value] of Object.entries(payload)) {
    if (!FIELD_MAPPING[key] && key !== 'install_utc_timestamp' && key !== 'is_viewthrough') {
      props[`$singular_${key}`] = value;
    }
  }
  
  props.$attribution_source = 'singular';
  props.$attribution_timestamp = new Date().toISOString();
  
  return props;
}

// ============================================
// MIXPANEL API
// ============================================

function callMixpanel(endpoint, data) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64');
    
    const options = {
      hostname: 'api.mixpanel.com',
      port: 443,
      path: `/${endpoint}?data=${encodeURIComponent(payload)}`,
      method: 'GET'
    };
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true });
        } else {
          reject(new Error(`Mixpanel ${endpoint} error: ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

function aliasUser(deviceId, userId) {
  return callMixpanel('track', {
    event: '$create_alias',
    properties: {
      token: CONFIG.MIXPANEL_TOKEN,
      distinct_id: deviceId,
      alias: userId
    }
  });
}

function setUserProperties(distinctId, properties) {
  return callMixpanel('engage', {
    $token: CONFIG.MIXPANEL_TOKEN,
    $distinct_id: distinctId,
    $set: properties
  });
}

function trackEvent(distinctId, eventName, properties) {
  return callMixpanel('track', {
    event: eventName,
    properties: {
      token: CONFIG.MIXPANEL_TOKEN,
      distinct_id: distinctId,
      time: Math.floor(Date.now() / 1000),
      ...properties
    }
  });
}

// ============================================
// MAIN HANDLER
// ============================================

exports.handler = async (event) => {
  try {
    // Check token
    if (!CONFIG.MIXPANEL_TOKEN) {
      console.error('MIXPANEL_TOKEN not configured');
      return { statusCode: 500, body: JSON.stringify({ error: 'Token not configured' }) };
    }
    
    // Parse payload
    let payload;
    if (event.body) {
      payload = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } else if (event.queryStringParameters) {
      payload = event.queryStringParameters;
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'No payload' }) };
    }
    
    // Get distinct_id
    const distinctId = getDistinctId(payload);
    if (!distinctId) {
      console.error('No distinct_id found');
      return { statusCode: 400, body: JSON.stringify({ error: 'No user identifier' }) };
    }
    
    // Get event name
    const eventName = getEventName(payload);
    
    // Map properties
    const properties = mapFields(payload);
    
    // Check if we need to alias
    const hasUserId = !!payload.user_id;
    const hasDeviceId = !!(payload.aifa || payload.idfa || payload.gaid || payload.idfv);
    const needsAlias = hasUserId && hasDeviceId;
    const deviceId = payload.aifa || payload.idfa || payload.gaid || payload.idfv;
    
    // Log only essential info
    console.log(JSON.stringify({
      event: eventName,
      distinct_id: distinctId,
      user_id: payload.user_id || null,
      device_id: deviceId || null,
      will_alias: needsAlias,
      campaign: payload.campaign || 'none',
      network: payload.network || 'none'
    }));
    
    // Send to Mixpanel with retries
    let attempt = 0;
    while (attempt < CONFIG.MAX_RETRIES) {
      try {
        // Alias if needed
        if (needsAlias) {
          await aliasUser(deviceId, payload.user_id);
        }
        
        // Set user properties
        await setUserProperties(distinctId, properties);
        
        // Track event
        await trackEvent(distinctId, eventName, properties);
        
        // Success
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            event: eventName,
            distinct_id: distinctId,
            aliased: needsAlias
          })
        };
        
      } catch (error) {
        attempt++;
        if (attempt >= CONFIG.MAX_RETRIES) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY_MS * attempt));
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};