var startApp = require('start-app');
var Spectrogram = require('./');
var db = require('decibels');
var ft = require('fourier-transform');
var ctx = require('audio-context');
var colorScales = require('colormap/colorScales');
var palettes = require('nice-color-palettes/200');
var colorParse = require('color-parse');
var flatten = require('flatten');


palettes = palettes
	.map((palette) => {
		return palette.map(v => {
			var parsed = colorParse(v);
			parsed.values.push(1);
			return parsed.values;
		})
	})
	.filter((palette) => {
		var start = palette[0], end = palette[palette.length - 1];
		var leftLightness = (start[0] * 299 + start[1] * 587 + start[2] * 114) / (1000);
		var rightLightness = (end[0] * 299 + end[1] * 587 + end[2] * 114) / (1000);
		if (Math.abs(leftLightness - rightLightness) < 128) {
			return false;
		}
		return true;
	});

//playback speed
var speed = 100;

//pick random palette
var palette = palettes[(Math.random() * palettes.length)|0];

//analyser
var source = null;
var analyser = ctx.createAnalyser();
analyser.frequencyBinCount = 4096;
analyser.smoothingTimeConstant = .1;
analyser.connect(ctx.destination);


//generate input sine
var N = 4096;
var sine = Array(N);
var saw = Array(N);
var noise = Array(N);
var rate = 44100;

for (var i = 0; i < N; i++) {
	sine[i] = Math.sin(10000 * Math.PI * 2 * (i / rate));
	saw[i] = 2 * ((1000 * i / rate) % 1) - 1;
	noise[i] = Math.random() * 2 - 1;
}

// var frequencies = ft(sine);
// var frequencies = Array(1024).fill(-150);
// var frequencies = ft(noise);
//NOTE: ios does not allow setting too big this value
var frequencies = new Float32Array(analyser.frequencyBinCount);
// for (var i = 0; i < frequencies.length; i++) frequencies[i] = -150;
// frequencies = frequencies.map((v) => db.fromGain(v));

var spectrogram = Spectrogram({
	smoothing: .1,
	fill: palette,
	// logarithmic: false,
	// autostart: false
	// weighting:
});


var app = startApp({
	color: palette[palette.length - 1],
	source: 'https://soundcloud.com/xlr8r/sets/xlr8r-top-10-downloads-of-may',
	params: {
		fill: {
			type: 'select',
			values: (() => {
				var values = {};
				for (var name in colorScales) {
					if (name === 'alpha') continue;
					if (name === 'hsv') continue;
					if (name === 'rainbow') continue;
					if (name === 'rainbow-soft') continue;
					if (name === 'phase') continue;
					values[name] = name;
				}
				return values;
			})(),
			value: 'greys',
			change: function (value, state) {
				spectrogram.setFill(value, this.getParamValue('inversed'));
				this.setColor(spectrogram.color);
			}
		},
		inversed: {
			value: false,
			change: function (value) {
				spectrogram.setFill(this.getParamValue('fill'), value);
				this.setColor(spectrogram.color);
			}
		},
		weighting: {
			values: {
				itu: 'itu',
				a: 'a',
				b: 'b',
				c: 'c',
				d: 'd',
				z: 'z'
			},
			value: spectrogram.weighting,
			change: v => {
				spectrogram.weighting = v;
			}
		},
		logarithmic: {
			value: spectrogram.logarithmic,
			change: v => {
				spectrogram.logarithmic = v;
				spectrogram.update();
			}
		},
		grid: {
			value: spectrogram.grid,
			change: v => {
				spectrogram.grid = v;
				spectrogram.update();
			}
		},
		// axes: spectrogram.axes,
		smoothing: {
			min: 0,
			max: 1,
			step: .01,
			value: spectrogram.smoothing,
			change: v => {
				spectrogram.smoothing = v;
			}
		},
		speed: {
			type: 'range',
			value: speed,
			min: 1,
			//4ms is minimal interval for HTML5 (250 times per second)
			max: 250,
			change: (v) => {
				speed = v;
			}
		},
		minDecibels: {
			type: 'range',
			value: spectrogram.minDecibels,
			min: -100,
			max: 0,
			change: (v) => {
				spectrogram.minDecibels = v;
				spectrogram.update();
			}
		},
		maxDecibels: {
			type: 'range',
			value: spectrogram.maxDecibels,
			min: -100,
			max: 0,
			change: (v) => {
				spectrogram.maxDecibels = v;
				spectrogram.update();
			}
		}
	}
});


var pushIntervalId;
app.on('ready', function (node) {
	source = node;
	source.disconnect();
	source.connect(analyser);
})
.on('play', function () {
	pushChunk();
})
.on('pause', function () {
	clearInterval(pushIntervalId);
});

function pushChunk () {
	// for (var i = 0; i < N; i++) {
	// 	frequencies[i] = Math.sin(10000 * Math.PI * 2 * (i / rate));
	// }
	// frequencies = ft(frequencies).map(db.fromGain);

	analyser.getFloatFrequencyData(frequencies);
	spectrogram.push(frequencies);

	pushIntervalId = setTimeout(pushChunk, 1000 / speed);
}
