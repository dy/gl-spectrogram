// var startApp = require('start-app');
var Spectrogram = require('./');
var db = require('decibels');
var ft = require('fourier-transform');



//generate input sine
var N = 2048;
var sine = Array(N);
var saw = Array(N);
var noise = Array(N);
var rate = 44100;

for (var i = 0; i < N; i++) {
	sine[i] = Math.sin(10000 * Math.PI * 2 * (i / rate));
	saw[i] = 2 * ((1000 * i / rate) % 1) - 1;
	noise[i] = Math.random() * 2 - 1;
}

var frequencies = ft(sine);
// var frequencies = new Float32Array(1024).fill(0.5);
// var frequencies = ft(noise);
//NOTE: ios does not allow setting too big this value
// var frequencies = new Float32Array(analyser.frequencyBinCount);
// for (var i = 0; i < frequencies.length; i++) frequencies[i] = -150;
frequencies = frequencies.map((v) => db.fromGain(v));

var spectrogram = Spectrogram({
	frequencies: frequencies,
	autostart: false
	// weighting:
});
spectrogram.render();



// var app = startApp({
// 	source: 'some_sound_cloud',
	// settings: {
	// 	weighting: {
	// 		values: {
	// 			itu: 'itu',
	// 			a: 'a',
	// 			b: 'b',
	// 			c: 'c',
	// 			d: 'd',
	// 			z: 'z'
	// 		},
	// 		value: spectrogram.weighting
	// 	},
	// 	logarithmic: spectrogram.logarithmic,
	// 	grid: spectrogram.grid,
	// 	axes: spectrogram.axes,
	// 	map: spectrogram.map,
	// 	smoothing: {
	// 		min: 0,
	// 		max: 1,
	// 		step: .01,
	// 		value: spectrogram.smoothing
	// 	}
	// }
// })
// .on('change', (e) => {
// 	spectrogram.update();
// });
