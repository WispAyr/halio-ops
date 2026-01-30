/**
 * Status Service - Real-time activity tracking for developer dashboard
 */

const os = require('os');
const fs = require('fs');

class StatusService {
  constructor() {
    this.startTime = Date.now();
    this.stats = {
      inferenceCount: 0,
      inferenceErrors: 0,
      totalInferenceMs: 0,
      lastInferenceAt: null,
    };
    
    // Ring buffer for recent activity (last 50 items)
    this.recentActivity = [];
    this.maxActivitySize = 50;
    
    // Current active jobs
    this.activeJobs = new Map();
    
    // Recent detections summary
    this.recentDetections = {
      people: 0,
      vehicles: 0,
      other: 0,
      lastReset: Date.now(),
    };
  }

  /**
   * Record start of an inference job
   */
  startJob(jobId, metadata = {}) {
    this.activeJobs.set(jobId, {
      startedAt: Date.now(),
      ...metadata,
    });
    this.logActivity('job_start', { jobId, ...metadata });
  }

  /**
   * Record completion of an inference job
   */
  completeJob(jobId, result = {}) {
    const job = this.activeJobs.get(jobId);
    if (job) {
      const duration = Date.now() - job.startedAt;
      this.activeJobs.delete(jobId);
      
      this.stats.inferenceCount++;
      this.stats.totalInferenceMs += duration;
      this.stats.lastInferenceAt = Date.now();
      
      // Count detections
      if (result.detections) {
        for (const det of result.detections) {
          const cls = (det.class || '').toLowerCase();
          if (['person', 'pedestrian', 'man', 'woman'].includes(cls)) {
            this.recentDetections.people++;
          } else if (['car', 'truck', 'bus', 'vehicle', 'motorcycle'].includes(cls)) {
            this.recentDetections.vehicles++;
          } else {
            this.recentDetections.other++;
          }
        }
      }
      
      this.logActivity('job_complete', { 
        jobId, 
        duration,
        detections: result.detections?.length || 0,
      });
    }
  }

  /**
   * Record a failed inference job
   */
  failJob(jobId, error) {
    const job = this.activeJobs.get(jobId);
    if (job) {
      this.activeJobs.delete(jobId);
      this.stats.inferenceErrors++;
      this.logActivity('job_error', { jobId, error: error.message || error });
    }
  }

  /**
   * Log activity to ring buffer
   */
  logActivity(type, data = {}) {
    this.recentActivity.push({
      timestamp: Date.now(),
      type,
      ...data,
    });
    
    // Trim to max size
    while (this.recentActivity.length > this.maxActivitySize) {
      this.recentActivity.shift();
    }
  }

  /**
   * Get system resource stats
   */
  getSystemStats() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    // Try to get CPU temp (Raspberry Pi specific)
    let cpuTemp = null;
    try {
      const tempFile = '/sys/class/thermal/thermal_zone0/temp';
      if (fs.existsSync(tempFile)) {
        const temp = parseInt(fs.readFileSync(tempFile, 'utf8').trim(), 10);
        cpuTemp = (temp / 1000).toFixed(1);
      }
    } catch {}
    
    return {
      cpuCores: cpus.length,
      loadAverage: loadAvg.map(l => l.toFixed(2)),
      memoryUsedMB: Math.round((totalMem - freeMem) / 1024 / 1024),
      memoryTotalMB: Math.round(totalMem / 1024 / 1024),
      memoryPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      cpuTemp,
    };
  }

  /**
   * Get full status for dashboard
   */
  getStatus() {
    const uptime = Date.now() - this.startTime;
    const avgInferenceMs = this.stats.inferenceCount > 0
      ? Math.round(this.stats.totalInferenceMs / this.stats.inferenceCount)
      : 0;
    
    // Reset detection counts every 5 minutes
    if (Date.now() - this.recentDetections.lastReset > 5 * 60 * 1000) {
      this.recentDetections = {
        people: 0,
        vehicles: 0,
        other: 0,
        lastReset: Date.now(),
      };
    }
    
    return {
      uptime: Math.round(uptime / 1000),
      uptimeFormatted: this.formatUptime(uptime),
      stats: {
        ...this.stats,
        avgInferenceMs,
      },
      activeJobs: Array.from(this.activeJobs.entries()).map(([id, job]) => ({
        id,
        duration: Date.now() - job.startedAt,
        ...job,
      })),
      recentDetections: { ...this.recentDetections },
      recentActivity: this.recentActivity.slice(-20).reverse(),
      system: this.getSystemStats(),
    };
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

module.exports = new StatusService();
