import { NextResponse } from 'next/server';

/**
 * Integration status stubs (Neo Connecting Your Stack — wire OAuth/tokens later).
 */
export async function GET() {
  return NextResponse.json({
    github: {
      configured: Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO),
      docs: 'https://docs.neo.projectdiscovery.io/integrations/github',
    },
    slack: {
      configured: Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID),
      docs: 'https://docs.neo.projectdiscovery.io/integrations/slack',
    },
    jira: {
      configured: Boolean(process.env.JIRA_HOST && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN),
      docs: 'https://docs.neo.projectdiscovery.io/integrations/jira',
    },
    linear: {
      configured: Boolean(process.env.LINEAR_API_KEY),
      docs: 'https://docs.neo.projectdiscovery.io/integrations/linear',
    },
  });
}
