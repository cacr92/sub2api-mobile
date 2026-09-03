import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const { proxy } = require('valtio');

const CCH_BASE_URL_KEY = 'cch_base_url';
const CCH_API_KEY_KEY = 'cch_admin_api_key';
const IS_WEB = Platform.OS === 'web';

export const DEFAULT_CCH_BASE_URL = 'https://cch.cacr.site';

export type CchConfigInput = {
  baseUrl: string;
  apiKey: string;
};

function normalizeCchConfig(input: CchConfigInput): CchConfigInput {
  return {
    baseUrl: input.baseUrl.trim().replace(/\/$/, ''),
    apiKey: input.apiKey.trim(),
  };
}

async function getItem(key: string) {
  try {
    if (IS_WEB) {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    }

    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setItem(key: string, value: string) {
  try {
    if (IS_WEB) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      return;
    }

    await SecureStore.setItemAsync(key, value);
  } catch {
    return;
  }
}

async function deleteItem(key: string) {
  try {
    if (IS_WEB) {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
      return;
    }

    await SecureStore.deleteItemAsync(key);
  } catch {
    return;
  }
}

function persistCchApiKey(value: string) {
  return IS_WEB ? deleteItem(CCH_API_KEY_KEY) : setItem(CCH_API_KEY_KEY, value);
}

export function getDefaultCchConfig(): CchConfigInput {
  return {
    baseUrl: DEFAULT_CCH_BASE_URL,
    apiKey: '',
  };
}

export function hasCchAdminSession(config: CchConfigInput) {
  return Boolean(config.baseUrl.trim() && config.apiKey.trim());
}

export const cchConfigState = proxy({
  ...getDefaultCchConfig(),
  hydrated: false,
  saving: false,
});

export async function hydrateCchConfig() {
  const defaults = getDefaultCchConfig();

  try {
    const [storedBaseUrl, storedApiKey] = await Promise.all([
      getItem(CCH_BASE_URL_KEY),
      getItem(CCH_API_KEY_KEY),
    ]);
    const config = normalizeCchConfig({
      baseUrl: storedBaseUrl?.trim() ? storedBaseUrl : defaults.baseUrl,
      apiKey: IS_WEB ? '' : storedApiKey ?? '',
    });

    cchConfigState.baseUrl = config.baseUrl;
    cchConfigState.apiKey = config.apiKey;

    await Promise.all([
      setItem(CCH_BASE_URL_KEY, config.baseUrl),
      persistCchApiKey(config.apiKey),
    ]);
  } finally {
    cchConfigState.hydrated = true;
  }
}

export async function saveCchConfig(input: CchConfigInput) {
  cchConfigState.saving = true;

  try {
    const config = normalizeCchConfig(input);

    await Promise.all([
      setItem(CCH_BASE_URL_KEY, config.baseUrl),
      persistCchApiKey(config.apiKey),
    ]);

    cchConfigState.baseUrl = config.baseUrl;
    cchConfigState.apiKey = config.apiKey;
  } finally {
    cchConfigState.saving = false;
  }
}
