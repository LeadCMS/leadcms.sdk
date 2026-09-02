#!/usr/bin/env node
/**
 * LeadCMS Watch Content CLI Entry Point
 */

import "dotenv/config";
import { watchContent } from "../../scripts/watch-content.js";

watchContent(process.argv.slice(2));
