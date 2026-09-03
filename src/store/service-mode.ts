import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const { proxy } = require('valtio');

const ACTIVE_SERVICE_KEY = 'sub2api_active_service';
const IS_WEB = Platform.OS === 'web';

export type ServiceMode = 'sub2api' | 'cch';

function isServiceMode(value: string | null): value is ServiceMode {
  return value === 'sub2api' || value === 'cch';
}

async function getItem() {
  try {
    if (IS_WEB) return typeof localStorage === 'undefined' ? null : localStorage.getItem(ACTIVE_SERVICE_KEY);
    return await SecureStore.getItemAsync(ACTIVE_SERVICE_KEY);
  } catch {
    return null;
  }
}

async function setItem(value: ServiceMode) {
  try {
    if (IS_WEB) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_SERVICE_KEY, value);
      return;
    }

    await SecureStore.setItemAsync(ACTIVE_SERVICE_KEY, value);
  } catch {
    return;
  }
}

export const serviceModeState = proxy({
  mode: 'sub2api' as ServiceMode,
  hydrated: false,
});

export async function hydrateServiceMode() {
  try {
    const storedMode = await getItem();
    serviceModeState.mode = isServiceMode(storedMode) ? storedMode : 'sub2api';
  } finally {
    serviceModeState.hydrated = true;
  }
}

export async function setServiceMode(mode: ServiceMode) {
  serviceModeState.mode = mode;
  await setItem(mode);
}
