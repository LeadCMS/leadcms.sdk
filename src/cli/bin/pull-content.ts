#!/usr/bin/env node
/**
 * LeadCMS Pull Content CLI Entry Point
 */

import { pullContent } from '../../scripts/pull-content.js';

pullContent().catch((error: any) => {
  console.error('Error running LeadCMS pull content:', error.message);
  process.exit(1);
});
