const { Events } = require('discord.js');

// ============================================
// CONFIGURATION - Update these values
// ============================================
const CONFIG = {
	// The exact text/phrase to look for in the user's custom status
	// Examples: "harami", "Harami", "🔴 harami"
	TARGET_STATUS: 'harami',

	// The Discord Role ID to assign/remove
	// Replace with your actual role ID (e.g., "1234567890123456789")
	ROLE_ID: 'YOUR_ROLE_ID_HERE',

	// Case sensitivity for status matching
	// Set to false to match "harami", "Harami", "HARAMI" etc.
	CASE_SENSITIVE: false,
};

// ============================================
// EVENT LISTENER
// ============================================
module.exports = {
	name: Events.PresenceUpdate,
	async execute(oldPresence, newPresence) {
		try {
			// Validate configuration
			if (CONFIG.ROLE_ID === 'YOUR_ROLE_ID_HERE') {
				console.warn(
					'⚠️  Custom Status Role: ROLE_ID not configured. Please set your role ID in the CONFIG object.'
				);
				return;
			}

			// Get the user and guild
			const user = newPresence.user;
			const guild = newPresence.guild;

			// Safety check: ensure we have guild and user data
			if (!guild || !user) return;

			// Fetch the member to ensure we have current role data
			let member;
			try {
				member = await guild.members.fetch(user.id);
			} catch (error) {
				console.error(`Failed to fetch member ${user.id}:`, error.message);
				return;
			}

			// Get the role object
			const role = guild.roles.cache.get(CONFIG.ROLE_ID);
			if (!role) {
				console.warn(
					`⚠️  Custom Status Role: Role with ID ${CONFIG.ROLE_ID} not found in guild ${guild.name}`
				);
				return;
			}

			// Extract the custom status activity
			const customStatusActivity = newPresence.activities.find(
				(activity) => activity.type === 4 // Activity type 4 is custom status
			);

			// Get the status text (if it exists)
			const statusText = customStatusActivity?.state || '';

			// Check if the status contains our target phrase
			const hasTargetStatus = CONFIG.CASE_SENSITIVE
				? statusText.includes(CONFIG.TARGET_STATUS)
				: statusText.toLowerCase().includes(CONFIG.TARGET_STATUS.toLowerCase());

			// Get the user's current roles
			const hasRole = member.roles.cache.has(CONFIG.ROLE_ID);

			// ============================================
			// LOGIC: Add or remove role based on status
			// ============================================

			if (hasTargetStatus && !hasRole) {
				// User's status contains target phrase AND doesn't have role → ADD role
				try {
					await member.roles.add(role, `Custom Status Role: Status contains "${CONFIG.TARGET_STATUS}"`);
					console.log(
						`✅ Role added to ${user.username}: Status contains "${CONFIG.TARGET_STATUS}"`
					);
				} catch (error) {
					console.error(
						`❌ Failed to add role to ${user.username}:`,
						error.message
					);
				}
			} else if (!hasTargetStatus && hasRole) {
				// User's status does NOT contain target phrase AND has role → REMOVE role
				try {
					await member.roles.remove(
						role,
						`Custom Status Role: Status no longer contains "${CONFIG.TARGET_STATUS}"`
					);
					console.log(
						`✅ Role removed from ${user.username}: Status changed`
					);
				} catch (error) {
					console.error(
						`❌ Failed to remove role from ${user.username}:`,
						error.message
					);
				}
			}
		} catch (error) {
			console.error('Error in presenceUpdate event:', error);
		}
	},
};
