    /* --- CENTRALIZED AUDIO SYSTEM --- */
    const TTBAudio = {
      ctx: null,
      soundEnabled: true,

      init() {
        const saved = localStorage.getItem('ttb_sound_enabled');
        if (saved !== null) {
          this.soundEnabled = (saved === 'true');
        }
        this.updateToggleUI();
      },

      getContext() {
        if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          this.ctx = new AudioContextClass();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        return this.ctx;
      },

      resume() {
        this.getContext();
      },

      toggleSound() {
        this.resume();
        this.soundEnabled = !this.soundEnabled;
        localStorage.setItem('ttb_sound_enabled', this.soundEnabled ? 'true' : 'false');
        this.updateToggleUI();
        if (this.soundEnabled) {
          this.playUI();
        }
      },

      updateToggleUI() {
        const btn = document.getElementById('soundToggleBtn');
        if (btn) {
          btn.innerText = this.soundEnabled ? '🔊 SFX: ON' : '🔇 SFX: OFF';
          btn.classList.toggle('muted', !this.soundEnabled);
        }
      },

      play(fn) {
        if (!this.soundEnabled) return;
        try {
          const ctx = this.getContext();
          if (ctx && ctx.state === 'running') {
            fn(ctx);
          }
        } catch (e) {}
      },

      playUI() {
        this.play((ctx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(600, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.04);
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.04);
        });
      },

      playSelect() {
        this.play((ctx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(440, ctx.currentTime);
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.06);
        });
      },

      playWin() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          [523.25, 659.25].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.08);
            gain.gain.setValueAtTime(0, now + i * 0.08);
            gain.gain.linearRampToValueAtTime(0.12, now + i * 0.08 + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.15);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.15);
          });
        });
      },

      playLose() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          [349.23, 261.63].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + i * 0.09);
            gain.gain.setValueAtTime(0.12, now + i * 0.09);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.14);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.09);
            osc.stop(now + i * 0.09 + 0.14);
          });
        });
      },

      playDraw() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          [330, 330].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.07);
            gain.gain.setValueAtTime(0.08, now + i * 0.07);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.06);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.07);
            osc.stop(now + i * 0.07 + 0.06);
          });
        });
      },

      playHint() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(587.33, now);
          osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
          gain.gain.setValueAtTime(0.09, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.16);
        });
      },

      playLevelUp() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          [523.25, 659.25, 783.99].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.07);
            gain.gain.setValueAtTime(0.14, now + i * 0.07);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.18);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.07);
            osc.stop(now + i * 0.07 + 0.18);
          });
        });
      },

      playFood() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          const pitchVar = (Math.random() * 60) - 30;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(480 + pitchVar, now);
          osc.frequency.exponentialRampToValueAtTime(820 + pitchVar, now + 0.05);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.05);
        });
      },

      playMilestone() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          [600, 900].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.06);
            gain.gain.setValueAtTime(0.12, now + i * 0.06);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.08);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.06);
            osc.stop(now + i * 0.06 + 0.08);
          });
        });
      },

      playNewBest() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          [587.33, 739.99, 880].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + i * 0.08);
            gain.gain.setValueAtTime(0.15, now + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.2);
          });
        });
      },

      playGameOver() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(110, now + 0.25);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.25);
        });
      },

      playStart() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(350, now);
          osc.frequency.exponentialRampToValueAtTime(520, now + 0.08);
          gain.gain.setValueAtTime(0.1, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.08);
        });
      },

      playSwap() {
        this.play((ctx) => {
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(380, now + 0.05);
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.05);
        });
      }
    };

    window.addEventListener('click', () => TTBAudio.resume(), { once: true });
    window.addEventListener('keydown', () => TTBAudio.resume(), { once: true });
    window.addEventListener('touchstart', () => TTBAudio.resume(), { once: true });
    document.addEventListener('DOMContentLoaded', () => TTBAudio.init());

