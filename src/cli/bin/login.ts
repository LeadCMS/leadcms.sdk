#!/usr/bin/env node
/**
 * LeadCMS Login CLI Entry Point
 */

import { loginLeadCMS } from '../../scripts/login-leadcms.js';

loginLeadCMS(process.argv.slice(2)).catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
