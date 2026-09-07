#!/usr/bin/env node
/**
 * LeadCMS Login CLI Entry Point
 */

import "dotenv/config";
import { loginLeadCMS } from "../../scripts/login-leadcms.js";
import { selectSite } from "./site-args.js";

const args = process.argv.slice(2);
// `login` must work before any remote is configured, so it uses the light
// site selector that does not evaluate leadcms-helpers.
selectSite(args);

loginLeadCMS(args).catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
