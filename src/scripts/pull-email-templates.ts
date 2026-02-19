#!/usr/bin/env node
/**
 * Pull email templates from LeadCMS
 */

import "dotenv/config";
import axios from "axios";
import { leadCMSUrl, leadCMSApiKey, EMAIL_TEMPLATES_DIR } from "./leadcms-helpers.js";
import { setCMSConfig, isEmailTemplatesSupported } from "../lib/cms-config-types.js";
import { fetchLeadCMSEmailTemplates, buildEmailTemplateIdIndex, deleteEmailTemplateFilesById, saveEmailTemplateFile } from "./fetch-leadcms-email-templates.js";
import { resetEmailTemplatesState } from "./pull-all.js";
import { logger } from "../lib/logger.js";

interface PullEmailTemplatesOptions {
  targetId?: string;
  /** When true, delete all local email template files and sync token before pulling. */
  reset?: boolean;
}

async function main(options: PullEmailTemplatesOptions = {}): Promise<void> {
  const { targetId, reset } = options;
  console.log(`\n📧 LeadCMS Pull Email Templates\n`);

  if (reset) {
    console.log(`🔄 Resetting email templates state...\n`);
    await resetEmailTemplatesState();
  }

  if (targetId) {
    const id = parseInt(targetId, 10);
    if (Number.isNaN(id)) {
      console.error(`❌ Invalid ID: ${targetId}`);
      return;
    }

    if (!leadCMSApiKey) {
      console.error(`❌ LEADCMS_API_KEY is required to pull email templates by ID`);
      return;
    }

    try {
      const url = new URL(`/api/email-templates/${id}`, leadCMSUrl).toString();
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${leadCMSApiKey}` },
        timeout: 10000,
      });

      if (!response.data) {
        console.log(`⚠️  Email template not found: ID ${id}`);
        return;
      }

      const index = await buildEmailTemplateIdIndex(EMAIL_TEMPLATES_DIR);
      await deleteEmailTemplateFilesById(index, String(id));

      const filePath = await saveEmailTemplateFile(response.data);
      console.log(`✅ Email template saved: ${filePath}`);
      console.log(`\n✨ Email templates pull completed!\n`);
      return;
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`⚠️  Email template not found: ID ${id}`);
        return;
      }
      if (error.response?.status === 401) {
        console.error(`❌ Authentication failed - check your LEADCMS_API_KEY`);
        return;
      }
      throw error;
    }
  }

  try {
    logger.verbose(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);

      if (!isEmailTemplatesSupported()) {
        console.log(`⏭️  Email templates entity not supported by this LeadCMS instance`);
        return;
      }

      logger.verbose(`✅ Email templates entity supported\n`);
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming email templates are supported (backward compatibility)\n`);
  }

  await fetchLeadCMSEmailTemplates();

  console.log(`\n✨ Email templates pull completed!\n`);
}

export { main as pullEmailTemplates };
