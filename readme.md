# gl-spectrogram [![unstable](http://badges.github.io/stability-badges/dist/unstable.svg)](http://github.com/badges/stability-badges)

Render spectrogram in webgl or 2d.

[![Spectrogram](https://raw.githubusercontent.com/audio-lab/gl-spectrogram/gh-pages/preview.png "Spectrogram")](http://audio-lab.github.io/gl-spectrogram/)

## Usage

[![npm install gl-spectrogram](https://nodei.co/npm/gl-spectrogram.png?mini=true)](https://npmjs.org/package/gl-spectrogram/)

```js
var createSpectrogram = require('gl-spectrogram');

var spectrogram = createSpectrogram({
	//placement settings
	container: document.body,
	canvas: canvas,
	context: 'webgl',

	//magnitude range to show
	maxDecibels: -30,
	minDecibels: -100,

	//frequency range
	maxFrequency: 20000,
	minFrequency: 20,
	sampleRate: 44100,
	weighting: 'itu',

	//grid settings
	grid: true,
	axes: false,
	logarithmic: true,
	colormap: true,

	//rendering settings
	smoothing: 0.5,
	details: 1,

	//grouping settings
	snap: false,
	group: 0,

	//style settings
	fill: 'inferno',
	background: null
});

//push new frequencies slice, or replace by the offset
spectrogram.setFrequencies(data, offset?);
```

## Related

* [gl-spectrum](https://github.com/audio-lab/gl-spectrum)
* [plot-grid](https://github.com/audio-lab/plot-grid)
* [start-app](https://github.com/audio-lab/start-app)