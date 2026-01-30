const { EventEmitter } = require('events');
const { OnvifDevice } = require('node-onvif');
const config = require('../config');

class OnvifService extends EventEmitter {
  constructor() {
    super();
    this.cameras = new Map();
    this.devices = new Map();
    config.onvifCameras.forEach((camera) => {
      this.cameras.set(camera.id, camera);
    });
  }

  listCameras() {
    return Array.from(this.cameras.values()).map((camera) => ({
      id: camera.id,
      name: camera.name,
      host: camera.host,
      port: camera.port,
      hasCredentials: Boolean(camera.username && camera.password),
    }));
  }

  async refreshCamera(id) {
    this.devices.delete(id);
    await this.ensureDevice(id, true);
  }

  async ensureDevice(id, force = false) {
    const cached = this.devices.get(id);
    if (cached && !force) {
      return cached;
    }

    const camera = this.cameras.get(id);
    if (!camera) {
      throw new Error(`ONVIF camera ${id} not configured.`);
    }

    const xaddr = camera.xaddr || `http://${camera.host}:${camera.port || 80}/onvif/device_service`;
    const device = new OnvifDevice({
      xaddr,
      user: camera.username,
      pass: camera.password,
    });

    try {
      await device.init();
      this.devices.set(id, device);
      this.emit('log', {
        camera: id,
        level: 'info',
        message: 'ONVIF device initialized successfully',
      });
      return device;
    } catch (err) {
      this.emit('log', {
        camera: id,
        level: 'error',
        message: `Failed to initialize ONVIF camera ${id}: ${err.message}`,
      });
      throw err;
    }
  }

  async getProfiles(id) {
    const device = await this.ensureDevice(id);
    const media = device.services?.media;
    if (!media || typeof media.getProfiles !== 'function') {
      throw new Error('ONVIF media service unavailable');
    }

    const res = await media.getProfiles();
    const profiles = res?.data?.GetProfilesResponse?.Profiles;
    if (!profiles) return [];
    const list = Array.isArray(profiles) ? profiles : [profiles];
    return list.map((profile) => ({
      token: profile.$?.token,
      name: profile.Name,
    }));
  }

  async getStreamUri(id, profileToken) {
    const device = await this.ensureDevice(id);
    const media = device.services?.media;
    if (!media || typeof media.getStreamUri !== 'function') {
      throw new Error('ONVIF media service unavailable');
    }

    let token = profileToken;
    if (!token) {
      const profiles = await this.getProfiles(id);
      if (!profiles.length) {
        throw new Error('No ONVIF profiles available');
      }
      token = profiles[0].token;
    }

    const res = await media.getStreamUri({ ProfileToken: token, Protocol: 'RTSP' });
    const uri = res?.data?.GetStreamUriResponse?.MediaUri?.Uri;
    if (!uri) {
      throw new Error('ONVIF stream URI not found');
    }
    return { uri, profileToken: token };
  }
}

module.exports = new OnvifService();
