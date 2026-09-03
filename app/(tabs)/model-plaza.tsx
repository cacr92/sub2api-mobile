import { CchModelPricesScreen } from '@/src/screens/cch-model-prices-screen';
import { ModelPlazaScreen } from '@/src/screens/model-plaza-screen';
import { serviceModeState } from '@/src/store/service-mode';

const { useSnapshot } = require('valtio/react');

export default function ModelPlazaRouteScreen() {
  const serviceMode = useSnapshot(serviceModeState);
  return serviceMode.mode === 'cch' ? <CchModelPricesScreen /> : <ModelPlazaScreen />;
}
