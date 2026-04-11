/**
 * Google Workspace Group Management
 * Wraps the Admin SDK Directory API for listing / adding / removing group members.
 * Uses a service account with domain-wide delegation, impersonating an admin user.
 */

import { google } from 'googleapis';
import fs from 'fs';

const SCOPES = ['https://www.googleapis.com/auth/admin.directory.group.member'];

class GoogleGroupsService {
  /**
   * @param {string} serviceAccountJsonPath - path to service account JSON key file
   * @param {string} adminEmail - Workspace admin email to impersonate (subject)
   * @param {string} groupEmail - the Google Group address to manage
   */
  constructor(serviceAccountJsonPath, adminEmail, groupEmail) {
    if (!fs.existsSync(serviceAccountJsonPath)) {
      throw new Error(`Service account file not found: ${serviceAccountJsonPath}`);
    }
    const key = JSON.parse(fs.readFileSync(serviceAccountJsonPath, 'utf8'));

    this.auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: SCOPES,
      subject: adminEmail
    });

    this.admin = google.admin({ version: 'directory_v1', auth: this.auth });
    this.groupEmail = groupEmail;
  }

  /**
   * List all members of the group. Handles pagination.
   * Returns [{ email, role, id }]
   */
  async listMembers() {
    const members = [];
    let pageToken;
    do {
      const res = await this.admin.members.list({
        groupKey: this.groupEmail,
        maxResults: 200,
        pageToken
      });
      for (const m of res.data.members || []) {
        if (m.email) {
          members.push({
            email: m.email.toLowerCase(),
            role: m.role || 'MEMBER',
            id: m.id || null
          });
        }
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    return members;
  }

  /**
   * Add a member to the group. Returns the inserted member resource.
   * Throws on API error (caller handles response).
   */
  async addMember(email) {
    const res = await this.admin.members.insert({
      groupKey: this.groupEmail,
      requestBody: {
        email: email.toLowerCase(),
        role: 'MEMBER'
      }
    });
    return {
      email: (res.data.email || email).toLowerCase(),
      role: res.data.role || 'MEMBER',
      id: res.data.id || null
    };
  }

  /**
   * Remove a member from the group by email.
   * Throws on API error.
   */
  async removeMember(email) {
    await this.admin.members.delete({
      groupKey: this.groupEmail,
      memberKey: email.toLowerCase()
    });
    return { email: email.toLowerCase() };
  }
}

export default GoogleGroupsService;
