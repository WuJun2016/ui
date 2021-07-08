import { inject as service } from '@ember/service';
import Component from '@ember/component';
import ViewNewEdit from 'shared/mixins/view-new-edit';
import layout from './template';
import {
  get, set, computed, setProperties, observer
} from '@ember/object';
import { next } from '@ember/runloop';
import { REGIONS } from 'shared/utils/amazon';
import { OCI_REGIONS } from 'shared/utils/oci';
import { Promise } from 'rsvp';
import { isEmpty } from '@ember/utils';

const CRED_CONFIG_CHOICES = [
  {
    name:        'amazon',
    displayName: 'Amazon',
    driver:      'amazonec2',
    configField: 'amazonec2credentialConfig',
  },
  {
    name:        'azure',
    displayName: 'Azure',
    driver:      'azure',
    configField: 'azurecredentialConfig',
  },
  {
    name:        'digitalOcean',
    displayName: 'Digital Ocean',
    driver:      'digitalocean',
    configField: 'digitaloceancredentialConfig',
  },
  {
    name:        'google',
    displayName: 'Google',
    driver:      'google',
    configField: 'googlecredentialConfig',
  },
  {
    name:        'harvester',
    displayName: 'Harvester',
    driver:      'harvester',
    configField: 'harvestercredentialConfig',
  },
  {
    name:        'linode',
    displayName: 'Linode',
    driver:      'linode',
    configField: 'linodecredentialConfig',
  },
  {
    name:        'oci',
    displayName: 'OCI',
    driver:      'oci',
    configField: 'ocicredentialConfig',
  },
  {
    name:        'pnap',
    displayName: 'phoenixNAP',
    driver:      'pnap',
    configField: 'pnapcredentialConfig',
  },
  {
    name:        'vmware',
    displayName: 'VMware vSphere',
    driver:      'vmwarevsphere',
    configField: 'vmwarevspherecredentialConfig',
  },
]

export default Component.extend(ViewNewEdit, {
  globalStore:               service(),
  digitalOcean:              service(),
  linode:                    service(),
  oci:                       service(),
  intl:                      service(),
  google:                    service(),
  router:                    service(),
  layout,
  nodeConfigTemplateType:    null,
  cloudCredentialType:       null,
  model:                     null,
  cancelAdd:                 null,
  doneSavingCloudCredential: null,
  disableHeader:             false,
  validatingKeys:            false,
  region:                    null,
  sinlgeCloudKeyChoice:      null,
  regionChoices:             REGIONS,
  ociRegionChoices:          OCI_REGIONS,
  mode:                      'new',
  urlInvalid:                false,
  urlWarning:                null,
  urlError:                  null,
  gkeProjectId:              null,
  clusters:                  null,

  init() {
    this._super(...arguments);

    let cloudCredentialType = 'amazon';
    let model               = null;
    const driverName = get(this, 'driverName') === 'aks' ? 'azure' : get(this, 'driverName');

    if (driverName) {
      let match           = CRED_CONFIG_CHOICES.findBy('driver', driverName);

      cloudCredentialType = get(match, 'name');
      model               = this.globalStore.createRecord({ type: 'cloudCredential' });
    } else {
      if (get(this, 'originalModel')) {
        let configField     = Object.keys(this.originalModel).find((key) => key.toLowerCase().includes('config'));
        let configChoice    = CRED_CONFIG_CHOICES.findBy('configField', configField);

        cloudCredentialType = get(configChoice, 'name');
        model               = this.originalModel.clone();
      } else {
        model        = this.globalStore.createRecord({ type: 'cloudCredential' });
      }
    }

    if (driverName === 'harvester' || cloudCredentialType === 'harvester') {
      this.fetchCluster();
    }

    setProperties(this, {
      cloudCredentialType,
      model,
    });

    if (!get(this, 'originalModel')) {
      this.initCloudCredentialConfig();
    }
  },

  actions: {
    selectConfig(configType) {
      this.cleanupPreviousConfig();
      set(this, 'cloudCredentialType', configType);

      this.initCloudCredentialConfig();
    },

    updateKubeconfigYaml(value) {
      set(this, 'config.kubeconfigContent', value);
    },
  },

  changeClusterId: observer('config.clusterId', function() {
    const clusterId = get(this, 'config.clusterId');

    if (!clusterId) {
      return;
    }

    const currentCluster = (get(this, 'clusters') || []).find( (C) => {
      return C.id === get(this, 'config.clusterId')
    });

    currentCluster.doAction('generateKubeconfig')
      .then((obj) => {
        set(this, 'config.kubeconfigContent', get(obj, 'config'));
      })
      .catch((err) => {
        this.get('growl').fromError('Error getting kubeconfig file', err);
      })
  }),

  clusterContent: computed('clusters', function() {
    const clusterContent = (get(this, 'clusters') || []).map((O) => {
      const value = O.id;
      const label = O.name;

      return {
        label,
        value
      }
    })

    return clusterContent;
  }),

  config: computed('cloudCredentialType', 'model.{amazonec2credentialConfig,azurecredentialConfig,digitaloceancredentialConfig,googlecredentialConfig,harvestercredentialConfig,linodecredentialConfig,ocicredentialConfig,pnapcredentialConfig,vmwarevspherecredentialConfig}', function() {
    const { model }   = this;
    const configField = this.getConfigField();

    return get(model, configField);
  }),

  configChoices: computed('driverName', function() {
    if (get(this, 'driverName')) {
      // const { driverName } = this;
      const driverName = get(this, 'driverName') === 'aks' ? 'azure' : get(this, 'driverName');

      let match = CRED_CONFIG_CHOICES.findBy('driver', driverName);

      next(() => {
        setProperties(this, {
          cloudCredentialType:         get(match, 'name'),
          singleCloudKeyChoice: get(match, 'displayName'),
        });
        this.initCloudCredentialConfig();
      })

      return [match];
    } else {
      return CRED_CONFIG_CHOICES.sortBy('displayName');
    }
  }),

  savingLabel: computed('validatingKeys', 'cloudCredentialType', function() {
    if (this.validatingKeys) {
      switch (this.cloudCredentialType) {
      case 'amazon':
      case 'digitalOcean':
      case 'linode':
      case 'azure':
      case 'google':
        return 'modalAddCloudKey.saving.validating';
      case 'oci':
      case 'pnap':
      case 'vmware':
      case 'harvester':
      default:
        return 'saveCancel.saving';
      }
    }

    return 'saveCancel.saving';
  }),

  validate() {
    if ((this.errors || []).length <= 0) {
      set(this, 'errors', []);
    }
    var ok                        = this._super(...arguments);
    let errors                    = [];
    const { cloudCredentialType } = this;

    if (cloudCredentialType === 'amazon') {
      if (!get(this, 'region')) {
        ok = false;

        errors.pushObject(this.intl.t('modalAddCloudKey.errors.region'));
      }
    }

    if (cloudCredentialType === 'azure') {
      const currentRoute = this.router.currentRoute;

      if (currentRoute?.name === 'global-admin.clusters.new.launch' && currentRoute?.params?.provider === 'azureaksv2' && isEmpty(get(this, 'config.tenantId'))) {
        ok = false;

        errors.pushObject(this.intl.t('modalAddCloudKey.errors.azureTenantId'));
      }
    }

    this.parseAndCollectErrors(errors, true);

    return ok;
  },

  willSave() {
    let ok = this._super(...arguments);

    if (!ok) {
      return ok;
    }

    const { cloudCredentialType }      = this;
    const keysThatWeCanValidate = ['amazon', 'digitalOcean', 'linode', 'oci', 'google'];
    const auth                  = {
      type:  'validate',
      token: null,
    };

    if (keysThatWeCanValidate.includes(cloudCredentialType)) {
      set(this, 'validatingKeys', true);

      if (cloudCredentialType === 'linode') {
        set(auth, 'token', get(this, 'config.token'));

        return this.linode.request(auth, 'profile').then(() => {
          set(this, 'validatingKeys', false);

          return true;
        }).catch((err) => {
          return this.setError(`${ err.status } ${ err.statusText }`);
        });
      }

      if (cloudCredentialType === 'digitalOcean') {
        set(auth, 'token', get(this, 'config.accessToken'));

        return this.digitalOcean.request(auth, 'regions').then(() => {
          set(this, 'validatingKeys', false);

          return true;
        }).catch((err) => {
          return this.setError(`${ err.status } ${ err.statusText }`);
        });
      }

      if (cloudCredentialType === 'amazon') {
        let authConfig = {
          accessKeyId:     this.config.accessKey,
          secretAccessKey: this.config.secretKey,
          region:          this.region,
        };
        let ec2        = new AWS.EC2(authConfig);

        return new Promise((resolve, reject) => {
          ec2.describeAccountAttributes({}, (err) => {
            if ( err ) {
              reject(err);
            }

            return resolve();
          })
        }).then(() => {
          set(this, 'validatingKeys', false);

          return true;
        }).catch((err) => {
          return this.setError(`${ err.statusCode } ${ err.code }`);
        });
      }

      if (cloudCredentialType === 'oci') {
        let authConfig = {
          region:               this.config.region,
          tenancyOCID:          this.config.tenancyId,
          userOCID:             this.config.userId,
          fingerprint:          this.config.fingerprint,
          privateKey:           this.config.privateKeyContents,
          privateKeyPassphrase: this.config.privateKeyPassphrase,
          token:                get(this, 'config.token'),
        };

        return this.oci.request(authConfig, 'availabilityDomains').then(() => {
          set(this, 'validatingKeys', false);

          return true;
        }).catch((err) => {
          return this.setError(`${ err.message }`);
        });
      }

      if (cloudCredentialType === 'google') {
        return this.fetchZones().then(() => {
          const auth = JSON.parse(get(this, 'config.authEncodedJson'));
          const projectId = auth?.project_id;

          set(this, 'gkeProjectId', projectId);
          set(this, 'validatingKeys', false);

          return true;
        }).catch((err) => {
          return this.setError(`${ err.message }`);
        });
      }
    }

    set(this, 'validatingKeys', false);

    return ok;
  },

  setError(message = '') {
    const translation = this.intl.t('modalAddCloudKey.errors.validation', { status: message });

    set(this, 'validatingKeys', false);

    this.parseAndCollectErrors(translation, true);

    return false;
  },

  initCloudCredentialConfig() {
    const { model }   = this;
    const configField = this.getConfigField();

    if (configField) {
      set(model, configField, this.globalStore.createRecord({ type: configField.toLowerCase() }));
    }
  },

  doneSaving(neu) {
    const driverName = get(this, 'driverName');
    const projectId = get(this, 'gkeProjectId');

    if (driverName === 'google' && projectId) {
      set(neu, this.getConfigField(), { projectId });
      set(this, 'gkeProjectId', null)
    } else {
      // API sends back empty object which doesn't overrite the keys when the response is merged.
      // Just need to ensure that when the user loads this model again the acceess key/secret/pw is not present.
      set(neu, this.getConfigField(), {});
    }

    this.model.replaceWith(neu);

    this.doneSavingCloudCredential(neu);
  },

  cleanupPreviousConfig() {
    const { model } = this;
    const configField = this.getConfigField();

    if (configField) {
      delete model[configField];
    }
  },

  getConfigField() {
    const { cloudCredentialType, configChoices } = this;

    if (cloudCredentialType) {
      const matchType = configChoices.findBy('name', cloudCredentialType);

      return get(matchType, 'configField');
    }

    return;
  },

  parseNodeTemplateConfigType(nodeTemplate) {
    return Object.keys(nodeTemplate).find((f) => f.toLowerCase().indexOf('config') > -1);
  },

  parseAndCollectErrors() {
    throw new Error('parseAndCollectErrors action is required!');
  },

  fetchCluster() {
    get(this, 'globalStore').findAll('cluster').then( (data) => {
      const harvesterCluster = (data || []).filter((C) => {
        return C.provider === 'harvester';
      })

      set(this, 'clusters', harvesterCluster)
    });
  },

  fetchZones() {
    let credentials = null;
    let config = null;
    let projectId = null;

    try {
      credentials = get(this, 'config.authEncodedJson');
      config = JSON.parse(credentials || '{}');
      projectId = get(config, 'project_id');
    } catch (error) {
      return Promise.reject({ message: 'Invalid JSON' });
    }

    return get(this, 'globalStore').rawRequest({
      url:    '/meta/gkeZones',
      method: 'POST',
      data:   {
        credentials,
        projectId,
      }
    }).then(() => {
      return Promise.resolve();
    }).catch((xhr) => {
      return Promise.reject({ message: xhr?.body?.error });
    });
  },
});
