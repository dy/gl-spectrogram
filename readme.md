# gl-spectrogram [![unstable](http://badges.github.io/stability-badges/dist/unstable.svg)](http://github.com/badges/stability-badges)

Render spectrogram in webgl or 2d.

[![Spectrogram](https://raw.githubusercontent.com/audio-lab/gl-spectrogram/gh-pages/preview.png "Spectrogram")](http://audio-lab.github.io/gl-spectrogram/)

## Usage

[![npm install gl-spectrogram](https://nodei.co/npm/gl-spectrogram.png?mini=true)](https://npmjs.org/package/gl-spectrogram/)

```js
var createSpectrogram = require('gl-spectrogram');

//lightweight 2d-canvas version
//var createSpectrogram = require('gl-spectrogram/2d');

var spectrogram = createSpectrogram({
	//placement settings
	container: document.body,
	canvas: canvas,
	context: 'webgl',

	//audio settings
	maxDecibels: -30,
	minDecibels: -100,
	maxFrequency: 20000,
	minFrequency: 20,
	sampleRate: 44100,
	weighting: 'itu',

	//grid settings
	grid: true,
	axes: false,
	logarithmic: true,

	//rendering settings
	smoothing: 0.5,
	fill: 'inferno',
	background: null,

	//useful only for webgl renderer, defines the size of data texture
	size: [1024, 1024]
});

//push frequencies data, view is shifted for 1 slice
spectrogram.push(data);

//for even timeflow push data in setTimeout, stream data event, scriptProcessorCallback etc.
setTimeout(() => {
	spectrogram.push(getData(data));
}, 100);

//set data colormap or background
spectrogram.setFill(colormap|color|pixels);
spectrogram.setBackground(color|array);

//update colors, grid view
spectrogram.update(opts);

//called when freqs being pushed
spectrogram.on('push', magnitudes => {});
spectrogram.on('update', magnitudes => {});

//latest frequencies data in db
spectrogram.magnitudes;
spectrogram.peak;
```

## Related

* [gl-spectrum](https://github.com/audio-lab/gl-spectrum)
* [plot-grid](https://github.com/audio-lab/plot-grid)
* [start-app](https://github.com/audio-lab/start-app)

## Inspiration

* [colormap](https://github.com/bpostlethwaite/colormap)
* [nice-color-palettes](https://github.com/Jam3/nice-color-palettes)