#!/usr/bin/env node
/**
 * LeadCMS Generate Env CLI Entry Point
 */

import "dotenv/config";
import { generateEnv } from "../../scripts/generate-env-js.js";

generateEnv();
