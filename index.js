/**
 * @module  gl-spectrogram
 */


var extend = require('xtend/mutable');
var Component = require('gl-component');
var inherits = require('inherits');
var isBrowser = require('is-browser');
var createGrid = require('plot-grid');
var colormap = require('colormap');
var flatten = require('flatten');
var lg = require('mumath/lg');
var clamp = require('mumath/clamp');
var weighting = require('a-weighting');

module.exports = Spectrogram;



/**
 * @contructor
 */
function Spectrogram (options) {
	if (!(this instanceof Spectrogram)) return new Spectrogram(options);

	Component.call(this, options);

	var gl = this.gl;

	if (isBrowser) this.container.classList.add('gl-spectrogram');

	//init RTT (render to texture) routine
	this.spectrogramTextures = [
		this.createTexture(),
		this.createTexture()
	];
	this.frequenciesTexture = this.createTexture();

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, this.spectrogramTextures[0]);
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, this.spectrogramTextures[1]);
	gl.activeTexture(gl.TEXTURE2);
	gl.bindTexture(gl.TEXTURE_2D, this.frequenciesTexture);

	//spectrogram texture for main program
	this.setTexture('frequencies', {
		unit: 3,
		data: null,
		format: gl.ALPHA,
		type: gl.UNSIGNED_BYTE,
		filter: this.gl.NEAREST,
		wrap: this.gl.CLAMP_TO_EDGE
	});
	this.setFrequencies(this.frequencies);

	/*
	//rendering phase
	this.phase = 0;

	//program, shifting texture
	this.shiftProgram = this.createProgram(this.vert, `
		precision highp float;

		uniform sampler2D data;
		uniform vec2 size;

		void main () {
			vec2 coord = vec2(vec2(gl_FragCoord.x + 1., gl_FragCoord.y) / size);
			float value = texture2D(data, coord).z;
			gl_FragColor = vec4(vec3(value), 1);
		}
	`);
	this.shiftSizeLocation = gl.getUniformLocation(this.program, 'size');
	this.shiftDataLocation = gl.getUniformLocation(this.program, 'data');

	//program, putting frequencies slice into texture
	this.freqProgram = this.createProgram(this.vert, `
		precision highp float;

		uniform sampler2D frequencies;
		uniform vec2 size;

		void main () {
			vec2 coord = vec2(gl_FragCoord.x / size.x, .5);
			float value = texture2D(frequencies, coord).z;
			gl_FragColor = vec4(vec3(value), 1);
		}
	`);
	this.freqSizeLocation = gl.getUniformLocation(this.program, 'size');
	this.freqDataLocation = gl.getUniformLocation(this.program, 'frequencies');
	gl.uniform1i(this.freqDataLocation, 2);

	//bind shift/freq attributes
	gl.bindAttribLocation(this.shiftProgram, 0, 'position');
	gl.bindAttribLocation(this.freqProgram, 0, 'position');

	//framebuffer for render2
	this.framebuffer = this.gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
	*/
}

inherits(Spectrogram, Component);

Spectrogram.prototype.antialias = false;
Spectrogram.prototype.premultipliedAlpha = true;
Spectrogram.prototype.alpha = true;
Spectrogram.prototype.float = false;

Spectrogram.prototype.maxDecibels = -0;
Spectrogram.prototype.minDecibels = -100;

Spectrogram.prototype.maxFrequency = 20000;
Spectrogram.prototype.minFrequency = 20;

Spectrogram.prototype.smoothing = 0.75;
Spectrogram.prototype.details = 1;

Spectrogram.prototype.snap = null;
Spectrogram.prototype.group = false;

Spectrogram.prototype.grid = true;
Spectrogram.prototype.axes = false;
Spectrogram.prototype.map = true;
Spectrogram.prototype.logarithmic = true;
Spectrogram.prototype.weighting = 'itu';
Spectrogram.prototype.sampleRate = 44100;

Spectrogram.prototype.fill = 'greys';
Spectrogram.prototype.balance = .65;
Spectrogram.prototype.background = undefined;


//default renderer just outputs active texture
Spectrogram.prototype.frag = `
	precision highp float;

	uniform sampler2D frequencies;
	// uniform sampler2D colormap;
	uniform vec4 viewport;

	void main () {
		vec2 coord = (gl_FragCoord.xy - viewport.xy) / viewport.zw;
		float intensity = texture2D(frequencies, coord).w;
		gl_FragColor = vec4(vec3(intensity), 1);
	}
`;


//array with initial values of the last moment
Spectrogram.prototype.frequencies = Array(1024).fill(-150);


//set last actual frequencies values
Spectrogram.prototype.setFrequencies = function (frequencies) {
	if (!frequencies) return this;

	var gl = this.gl;
	var minF = this.minFrequency, maxF = this.maxFrequency;
	var minDb = this.minDecibels, maxDb = this.maxDecibels;
	var halfRate = this.sampleRate * 0.5;
	var l = halfRate / this.frequencies.length;

	//choose bigger data
	var bigger = this.frequencies.length >= frequencies.length ? this.frequencies : frequencies;
	var shorter = (bigger === frequencies ? this.frequencies : frequencies);
	bigger = [].slice.call(bigger);

	//apply smoothing
	var smoothing = (bigger === this.frequencies ? 1 - this.smoothing : this.smoothing);

	for (var i = 0; i < bigger.length; i++) {
		bigger[i] = clamp(bigger[i], -100, 0) * smoothing + clamp(shorter[Math.floor(shorter.length * (i / bigger.length))], -100, 0) * (1 - smoothing);
	}

	//save actual frequencies
	this.frequencies = bigger;

	//prepare f’s for rendering
	magnitudes = bigger.slice();

	//apply a-weighting
	if (weighting[this.weighting]) {
		var w = weighting[this.weighting];
		magnitudes = magnitudes.map((mag, i, data) => clamp(mag + 20 * Math.log(w(i * l)) / Math.log(10), -200, 0));
	}

	//map mags to 0..255 range limiting by db subrange
	magnitudes = magnitudes.map((value) => clamp(255 * (value - minDb) / (maxDb - minDb), 0, 255));

	return this.setTexture('frequencies', magnitudes);
};


//render, shifting the texture
Spectrogram.prototype.render = function () {
	var gl = this.gl;

	/*
	var width, height;

	//TODO: make control of rendering speed

	var phase = this.phase;
	this.phase = (this.phase + 1) % 2;

	//render shifted texture
	gl.viewport(0,0,width,height);
	gl.useProgram(this.shiftProgram);
	gl.uniform1i(this.shiftDataLocation, phase);
	gl.bindFramebuffer(this.framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.spectrogramTextures[this.phase], 0);
	gl.drawArrays(gl.TRIANGLES, 0, 3);


	//render last frequencies slice
	gl.viewport(width - 1,0,1,height);
	gl.useProgram(this.freqProgram);
	gl.drawArrays(gl.TRIANGLES, 0, 3);

	//switch to canvas renderbuffer, render texture there
	gl.bindFramebuffer(null);
	*/

	Component.prototype.render.call(this);
};