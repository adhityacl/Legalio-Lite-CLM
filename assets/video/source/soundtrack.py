"""Original 15-second instrumental and transition SFX; no sampled recordings.
Requires numpy. Usage: python soundtrack.py /tmp/legalio-soundtrack.wav
"""
import sys
import wave
import numpy as np

RATE = 48000
DURATION = 15
rng = np.random.default_rng(1729)
mix = np.zeros((RATE * DURATION, 2), dtype=np.float64)


def add(at, signal, gain=1, pan=0):
    start = int(at * RATE)
    end = min(len(mix), start + len(signal))
    if end <= start:
        return
    signal = signal[:end-start] * gain
    mix[start:end, 0] += signal * np.sqrt((1-pan)/2)
    mix[start:end, 1] += signal * np.sqrt((1+pan)/2)


def tone(midi, duration, soft=False):
    t = np.arange(int(duration*RATE))/RATE
    f = 440 * 2**((midi-69)/12)
    if soft:
        env = np.minimum(t/.22, 1)*np.minimum((duration-t)/.4, 1)
        return (np.sin(2*np.pi*f*t)+.18*np.sin(2*np.pi*f*2*t)) * env
    env = (1-np.exp(-t*240))*np.exp(-t*5.8)*np.minimum((duration-t)/.03, 1)
    return (np.sin(2*np.pi*f*t)+.32*np.sin(2*np.pi*f*2*t)+.12*np.sin(2*np.pi*f*3*t))*env


# Warm Dm9 / Bbmaj7 / Fmaj7 / Cadd9 / Dm9 pads and eighth-note arpeggio.
chords = [[50,57,60,64], [46,53,57,60], [41,48,52,57], [48,55,60,62], [50,57,60,64]]
for section, chord in enumerate(chords):
    at = section * 3
    for j, note in enumerate(chord):
        add(at, tone(note+12, 3.3, soft=True), .038, (j-1.5)*.34)
    for k in range(12):
        note = chord[[0,2,1,3,2,1][k%6]]+24
        add(at+k*.25, tone(note,.8), .115 if k%2==0 else .065, (-.48 if k%2 else .48))
    for k in range(6):
        add(at+k*.5, tone(chord[0]-12,.45), .18)

# Rounded electronic kick, tight clap, and stereo hats.
for beat in range(29):
    at = beat*.5
    t = np.arange(int(.34*RATE))/RATE
    phase = 2*np.pi*(48*t + 80*.028*(1-np.exp(-t/.028)))
    kick = np.sin(phase)*np.exp(-t*15)*(1-np.exp(-t*500))
    add(at, kick,.43)
    if beat%2:
        t=np.arange(int(.18*RATE))/RATE
        n=rng.standard_normal(len(t));n=np.r_[0,np.diff(n)]*.5
        clap=n*np.exp(-t*33)*(1-np.exp(-t*900))
        add(at,clap,.095,.1)
for k in range(58):
    t=np.arange(int(.075*RATE))/RATE
    noise=rng.standard_normal(len(t));noise=np.r_[0,np.diff(noise)]*.4
    add(k*.25,noise*np.exp(-t*65),.033 if k%2 else .022,(-.5 if k%2 else .5))

# Swept air before each wipe, a soft impact, and crisp UI confirmation chimes.
for boundary in [3,6,9,12]:
    t=np.arange(int(.52*RATE))/RATE
    noise=rng.standard_normal(len(t))
    air=np.convolve(noise,np.ones(9)/9,mode='same')
    envelope=np.sin(np.pi*t/.52)**2
    sweep=np.sin(2*np.pi*(320*t+1100*t*t))*.15
    add(boundary-.38,(air+sweep)*envelope,.18,-.15)
    add(boundary,tone(38,.7),.19)
for at in [3.4,3.82,4.24,7.05,9.8,10.03,10.26,13.0]:
    add(at,tone(86,.30),.07,.25)
    add(at+.065,tone(93,.35),.045,-.25)
add(12.15,tone(74,1.3),.13,-.3)
add(12.25,tone(81,1.2),.11,.3)
add(12.35,tone(86,1.1),.10)

# Short stereo echo, gentle saturation, and clean fade for the final logo hold.
delay=int(.1875*RATE)
mix[delay:] += mix[:-delay, ::-1].copy()*.12
mix=np.tanh(mix*1.3)
t=np.arange(len(mix))/RATE
mix *= (np.minimum(t/.025,1)*np.clip((15-t)/.7,0,1))[:,None]
mix *= .88/np.max(np.abs(mix))
assert np.isfinite(mix).all() and len(mix)==720000
with wave.open(sys.argv[1], 'wb') as out:
    out.setnchannels(2);out.setsampwidth(2);out.setframerate(RATE)
    out.writeframes((mix*32767).astype('<i2').tobytes())
print('Original soundtrack: 15.000 s, 48 kHz stereo, peak -1.11 dBFS')
