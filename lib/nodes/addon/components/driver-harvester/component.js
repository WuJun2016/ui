import { alias } from '@ember/object/computed';
import { get, set, computed } from '@ember/object';
import Component from '@ember/component';
import NodeDriver from 'shared/mixins/node-driver';
import layout from './template';
import { inject as service } from '@ember/service';
import { throttledObserver } from 'ui/utils/debounce';

const DRIVER = 'harvester';
const CONFIG = 'harvesterConfig';

const SYSTEM_NAMESPACES = [
  'cattle-dashboards',
  'cattle-global-data',
  'cattle-system',
  'gatekeeper-system',
  'ingress-nginx',
  'kube-node-lease',
  'kube-public',
  'kube-system',
  'linkerd',
  'rio-system',
  'security-scan',
  'tekton-pipelines',
];

export default Component.extend(NodeDriver, {
  growl:     service(),
  settings: service(),
  intl:     service(),

  layout,
  driverName:           DRIVER,
  model:                {},

  currentCluster:     null,
  clusters:           [],
  clusterContent:     [],
  imageContent:       [],
  networkContent:     [],
  namespaceContent:   [],
  networkDataContent: [],
  userDataContent:    [],
  networkDataValue:   '',
  userDataValue:      '',
  controller:         null,
  signal:             '',
  isImportMode:       true,
  cloudConfig:        '',

  config: alias(`model.${ CONFIG }`),

  init() {
    this._super(...arguments);

    const controller = new AbortController();

    set(this, 'controller', controller);
  },

  actions: {
    finishAndSelectCloudCredential(credential) {
      set(this, 'model.cloudCredentialId', get(credential, 'id'))
    },

    updateYaml(type, value) {
      set(this,  `config.${ type }`, value);
    },
  },

  currentCredential: computed('cloudCredentials', 'model.cloudCredentialId', function() {
    return (get(this, 'cloudCredentials') || []).find((C) => C.id === get(this, 'model.cloudCredentialId')) || {};
  }),

  clusterId: computed('model.cloudCredentialId', 'currentCredential', function() {
    return get(this, 'currentCredential') && get(this, 'currentCredential').harvestercredentialConfig && get(this, 'currentCredential').harvestercredentialConfig.clusterId;
  }),

  url: computed('clusterId', function() {
    const clusterId = get(this, 'clusterId');

    return clusterId  === 'local' ? '' : `/k8s/clusters/${ clusterId }`;
  }),

  isImported: computed('model.cloudCredentialId', 'currentCredential', function() {
    if (get(this, 'currentCredential') && get(this, 'currentCredential').harvestercredentialConfig) {
      return get(this, 'currentCredential').harvestercredentialConfig.clusterType === 'imported';
    }

    return false
  }),

  fetchResource: throttledObserver('clusterId', 'model.cloudCredentialId', async function() {
    if (!get(this, 'clusterId')) {
      return;
    }

    let controller = get(this, 'controller');
    let signal = get(this, 'signal');

    const url = get(this, 'url');

    signal = controller.signal;
    set(this, 'signal', signal);

    get(this, 'globalStore').rawRequest({ url: `${ url }/v1/harvesterhci.io.virtualmachineimages` }).then((resp) => {
      const data = resp.body.data || [];
      const arr = data.filter((O) => {
        return !O.spec.url.endsWith('.iso');
      }).map((O) => {
        const value = O.id;
        const label = `${ O.spec.displayName } (${ value })`;

        return {
          label,
          value
        }
      });

      set(this, 'imageContent', arr);
    }).catch((err) => {
      set(this, 'imageContent', []);
      const message = err.statusText || err.message;

      get(this, 'growl').fromError('Error request Image API', message);
    });

    get(this, 'globalStore').rawRequest({ url: `${ url }/v1/k8s.cni.cncf.io.networkattachmentdefinition` }).then((resp) => {
      const data = resp.body.data || [];
      const arr = data.map((O) => {
        let id = '';

        try {
          const config = JSON.parse(O.spec.config);

          id = config.vlan;
        } catch (err) {
          console.log(err)
        }

        const value = O.id;
        const label = `${ value } (vlanId=${ id })`;

        return {
          label,
          value
        }
      });

      set(this, 'networkContent', arr);
    }).catch((err) => {
      set(this, 'networkContent', []);
      const message = err.statusText || err.message;

      get(this, 'growl').fromError('Error request Network API', message);
    });

    get(this, 'globalStore').rawRequest({ url: `${ url }/v1/namespace` }).then((resp) => {
      const data = resp.body.data || [];

      const arr = data
        .filter((O) => {
          return !this.isSystemNamespace(O);
        })
        .map((O) => {
          const value = O.id;
          const label = O.id;

          return {
            label,
            value
          }
        });

      set(this, 'namespaceContent', arr);
    }).catch((err) => {
      set(this, 'namespaceContent', []);
      const message = err.statusText || err.message;

      get(this, 'growl').fromError('Error request Namespace API', message);
    });

    get(this, 'globalStore').rawRequest({ url: `${ url }/v1/configmap` }).then((resp) => {
      const data = resp.body.data || [];
      const networkDataContent = [];
      const userDataContent = [];

      data.map((O) => {
        const cloudTemplate = O.metadata && O.metadata.labels && O.metadata.labels['harvesterhci.io/cloud-init-template'];
        const value = O.data && O.data.cloudInit;
        const label = O.metadata.name;

        if (cloudTemplate === 'user') {
          userDataContent.push({
            label,
            value
          })
        } else if (cloudTemplate === 'network') {
          networkDataContent.push({
            label,
            value
          })
        }
      });

      set(this, 'userDataContent', userDataContent);
      set(this, 'networkDataContent', networkDataContent);
    }).catch((err) => {
      set(this, 'userDataContent', []);
      set(this, 'networkDataContent', []);

      const message = err.statusText || err.message;

      get(this, 'growl').fromError('Error request cloudConfig API', message);
    });

    controller.abort()
  }),

  isSystemNamespace(namespace) {
    if ( namespace.metadata && namespace.metadata.annotations && namespace.metadata.annotations['management.cattle.io/system-namespace'] === 'true' ) {
      return true;
    }

    if ( SYSTEM_NAMESPACES.includes(namespace.metadata.name) ) {
      return true;
    }

    if ( namespace.metadata && namespace.metadata.name && namespace.metadata.name.endsWith('-system') ) {
      return true;
    }

    return false;
  },

  bootstrap() {
    let config = get(this, 'globalStore').createRecord({
      type:                    CONFIG,
      cpuCount:                2,
      memorySize:              4,
      diskSize:                40,
      diskBus:                 'virtio',
      imageName:               '',
      sshUser:                 '',
      networkName:             '',
      networkData:             '',
      vmNamespace:             '',
      userData:                ''
    });

    set(this, `model.${ CONFIG }`, config);
  },

  validate() {
    this._super();
    let errors = get(this, 'errors') || [];

    if (!this.validateCloudCredentials()) {
      errors.push(this.intl.t('nodeDriver.cloudCredentialError'))
    }

    if (!get(this, 'config.vmNamespace')) {
      errors.push(this.intl.t('generic.required', { key: this.intl.t('nodeDriver.harvester.namespace.label') }));
    }

    if (!get(this, 'config.diskBus')) {
      errors.push(this.intl.t('generic.required', { key: this.intl.t('nodeDriver.harvester.diskBus.label') }));
    }

    if (!get(this, 'config.imageName')) {
      errors.push(this.intl.t('generic.required', { key: this.intl.t('nodeDriver.harvester.imageName.label') }));
    }

    if (!get(this, 'config.networkName')) {
      errors.push(this.intl.t('generic.required', { key: this.intl.t('nodeDriver.harvester.networkName.label') }));
    }

    if (!get(this, 'config.sshUser')) {
      errors.push(this.intl.t('generic.required', { key: this.intl.t('nodeDriver.harvester.sshUser.label') }));
    }
    // Set the array of errors for display,
    // and return true if saving should continue.

    if (errors.length) {
      set(this, 'errors', errors.uniq());

      return false;
    }

    return true;
  },
});
