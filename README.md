Overview

What This Integration Does
This server-side integration captures attribution data from Singular and sends it to Mixpanel as user properties and events. It provides accurate attribution tracking for both iOS and Android users.

Key Features:

✅ Captures attribution data from Singular postbacks
✅ Sets user properties in Mixpanel with attribution details
✅ Tracks attribution events (install, reengagement, login)
✅ Links device IDs to user IDs automatically
✅ Handles both organic and paid installs
✅ Retry logic for reliability

Why Server-Side?
Server-side integration provides:

Accuracy: No data loss from SDK issues
Debugging: Complete visibility via CloudWatch logs
Flexibility: Easy to modify field mappings
Reliability: Retry logic ensures data delivery
Control: Independent of Singular's direct integration

Architecture
Data Flow
User Installs App
       ↓
Singular SDK (in app)
       ↓
Singular Platform (processes attribution)
       ↓
Singular Postback → API Gateway
       ↓
AWS Lambda Function
       ↓
Mixpanel API
       ↓
Mixpanel User Profile (updated)

