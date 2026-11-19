/** Shared auth constants (Microsoft public client ids for Minecraft Java Edition). */
const DEFAULT_MSA_CLIENT_ID = '00000000402b5328'; // Minecraft Java Edition (legacy public client id)
const FALLBACK_MSA_CLIENT_IDS = ['000000004c12ae6f', '0000000048183522']; // Xbox App iOS, Minecraft Android
const MSA_DEVICE_CODE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const MSA_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';

module.exports = {
  DEFAULT_MSA_CLIENT_ID,
  FALLBACK_MSA_CLIENT_IDS,
  MSA_DEVICE_CODE_URL,
  MSA_TOKEN_URL
};
