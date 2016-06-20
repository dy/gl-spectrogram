/**
 * @module  gl-spectrogram
 */


var extend = require('xtend/mutable');
var Component = require('gl-component');
var inherits = require('inherits');
var isBrowser = require('is-browser');
var createGrid = require('plot-grid');
var flatten = require('flatten');
var lg = require('mumath/lg');
var clamp = require('mumath/clamp');
var weighting = require('a-weighting');
var colormap = require('colormap');
var parseColor = require('color-parse');
var hsl = require('color-space/hsl');
var colorScales = require('colormap/colorScales');

module.exports = Spectrogram;



/**
 * @contructor
 */
function Spectrogram (options) {
	if (!(this instanceof Spectrogram)) return new Spectrogram(options);

	Component.call(this, options);

	var gl = this.gl;

	if (isBrowser) this.container.classList.add('gl-spectrogram');

	//preset colormap texture
	this.setTexture('colormap', {
		unit: 3,
		type: gl.UNSIGNED_BYTE,
		filter: gl.LINEAR,
		wrap: gl.CLAMP_TO_EDGE,
	});

	//save texture location
	this.textureLocation = gl.getUniformLocation(this.program, 'texture');

	var size = [1024, 512];

	this.shiftComponent = Component({
		context: gl,
		textures: {
			texture: {
				unit: 0,
				data: null,
				format: gl.RGBA,
				type: gl.UNSIGNED_BYTE,
				filter: gl.NEAREST,
				wrap: gl.CLAMP_TO_EDGE,
				width: size[0],
				height: size[1]
			},
			altTexture: {
				unit: 1,
				data: null,
				format: gl.RGBA,
				type: gl.UNSIGNED_BYTE,
				filter: gl.NEAREST,
				wrap: gl.CLAMP_TO_EDGE,
				width: size[0],
				height: size[1]
			},
			frequencies: {
				unit: 2,
				data: null,
				format: gl.ALPHA,
				type: gl.UNSIGNED_BYTE,
				filter: gl.NEAREST,
				wrap: gl.CLAMP_TO_EDGE
			}
		},
		frag: `
			precision highp float;

			uniform sampler2D texture;
			uniform sampler2D frequencies;
			uniform vec4 viewport;

			void main () {
				vec2 coord = vec2((vec2(gl_FragCoord.x + 1., gl_FragCoord.y) - viewport.xy) / viewport.zw);
				vec3 color = texture2D(texture, coord).xyz;
				if (gl_FragCoord.x - viewport.x >= viewport.z - 1.) {
					color = texture2D(frequencies, vec2(coord.y,.5)).www;
				}
				gl_FragColor = vec4(vec3(color), 1);
			}
		`,
		phase: 0,
		spectrogram: this,
		framebuffer: gl.createFramebuffer(),
		render: function () {
			var gl = this.gl;

			gl.useProgram(this.program);

			//TODO: throttle rendering here
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[this.phase ? 'texture' : 'altTexture'].texture, 0);
			gl.uniform1i(this.textures.texture.location, this.phase);

			this.phase = (this.phase + 1) % 2;

			//vp is unbound from canvas, so we have to manually set it
			gl.uniform4fv(gl.getUniformLocation(this.program, 'viewport'), [0,0,size[0], size[1]]);
			gl.viewport(0,0,size[0],size[1]);
			this.draw(this);

			gl.bindFramebuffer(gl.FRAMEBUFFER, null);

			gl.useProgram(this.spectrogram.program);
			gl.uniform1i(this.spectrogram.textureLocation, this.phase);
		},
		autostart: false,
		float: this.float,
		antialias: this.antialias
	});

	//preset initial freqs
	this.push(this.frequencies);

	//init style props
	this.update();
}

inherits(Spectrogram, Component);


//default renderer just outputs active texture
Spectrogram.prototype.frag = `
	precision highp float;

	uniform sampler2D texture;
	uniform sampler2D colormap;
	uniform vec4 viewport;

	void main () {
		vec2 coord = (gl_FragCoord.xy - viewport.xy) / viewport.zw;
		float intensity = texture2D(texture, coord).x;
		gl_FragColor = vec4(vec3(texture2D(colormap, vec2(intensity, coord.y) )), 1);
		// gl_FragColor = vec4(vec3(intensity), 1);
	}
`;

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

Spectrogram.prototype.grid = true;
Spectrogram.prototype.axes = false;
Spectrogram.prototype.logarithmic = true;
Spectrogram.prototype.weighting = 'itu';
Spectrogram.prototype.sampleRate = 44100;

Spectrogram.prototype.fill = 'greys';
Spectrogram.prototype.background = undefined;



//array with initial values of the last moment
Spectrogram.prototype.frequencies = Array(1024).fill(-150);


//set last actual frequencies values
Spectrogram.prototype.push = function (frequencies) {
	if (!frequencies) frequencies = [-150];

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

	this.shiftComponent.setTexture('frequencies', magnitudes);

	//do shift
	this.shiftComponent.render();

	return this;
};


/**
 * Reset colormap
 */
Spectrogram.prototype.setFill = function (cm, inverse) {
	this.fill = cm;

	//named colormap
	if (typeof cm === 'string') {
		//a color scale
		if (colorScales[cm]) {
			var cm = (flatten(colormap({
				colormap: cm,
				nshades: 128,
				format: 'rgba',
				alpha: 1
			})));//.map((v,i) => !((i + 1) % 4) ? v : v/255));
		}
		//url
		else if (/\\|\//.test(cm)) {
			this.setTexture('fill', cm);
			return this;
		}
		//plain color or CSS color string
		else {
			var parsed = parseColor(cm);

			if (parsed.space === 'hsl') {
				cm = hsl.rgb(parsed.values);
			}
			else {
				cm = parsed.values;
			}
		}
	}
	else if (!cm) {
		if (!this.background) this.setBackground([1,1,1,1]);
		return this;
	}
	//image, canvas etc
	else if (!Array.isArray(cm)) {
		this.setTexture('fill', cm);

		return this;
	}
	//custom array, like palette etc.
	else {
		cm = flatten(cm);
	}

	if (inverse) {
		var reverse = cm.slice();
		for (var i = 0; i < cm.length; i+=4){
			reverse[cm.length - i - 1] = cm[i + 3];
			reverse[cm.length - i - 2] = cm[i + 2];
			reverse[cm.length - i - 3] = cm[i + 1];
			reverse[cm.length - i - 4] = cm[i + 0];
		}
		cm = reverse;
	}

	this.setTexture('colormap', {
		data: cm,
		height: 1,
		width: (cm.length / 4)|0
	});

	//ensure bg
	if (!this.background) {
		this.setBackground(cm.slice(0, 4));
	}

	//set grid color to colormap’s color
	if (this.gridComponent) {
		var gridColor = cm.slice(-4);
		this.gridComponent.linesContainer.style.color = `rgba(${gridColor})`;
	}

	return this;
};


/** Set background */
Spectrogram.prototype.setBackground = function (bg) {
	if (this.background !== null) {
		var bgStyle = null;
		if (typeof bg === 'string') {
			bgStyle = bg;
		}
		else if (Array.isArray(bg)) {
			//map 0..1 range to 0..255
			if (bg[0] && bg[0] <= 1 && bg[1] && bg[1] <= 1 && bg[2] && bg[2] <= 1) {
				bg = [
					bg[0] * 255, bg[1] * 255, bg[2] * 255, bg[3] || 1
				];
			}

			bgStyle = `rgba(${bg.slice(0,3).map(v => Math.round(v)).join(', ')}, ${bg[3]})`;
		}
		this.canvas.style.background = bgStyle;
	}

	return this;
};




//update view
Spectrogram.prototype.update = function () {
	var gl = this.gl;

	if (this.grid && !this.gridComponent) {
		this.gridComponent = createGrid({
			container: this.container,
			viewport: () => this.viewport,
			lines: Array.isArray(this.grid.lines) ? this.grid.lines : (this.grid.lines === undefined || this.grid.lines === true) && [{
				min: this.minFrequency,
				max: this.maxFrequency,
				orientation: 'y',
				logarithmic: this.logarithmic,
				titles: function (value) {
					return (value >= 1000 ? ((value / 1000).toLocaleString() + 'k') : value.toLocaleString()) + 'Hz';
				}
			}, this.logarithmic ? {
				min: this.minFrequency,
				max: this.maxFrequency,
				orientation: 'y',
				logarithmic: this.logarithmic,
				values: function (value) {
					var str = value.toString();
					if (str[0] !== '1') return null;
					return value;
				},
				titles: null,
				style: {
					borderLeftStyle: 'solid',
					pointerEvents: 'none',
					opacity: '0.08',
					display: this.logarithmic ? null :'none'
				}
			} : null],
			axes: Array.isArray(this.grid.axes) ? this.grid.axes : (this.grid.axes || this.axes) && [{
				name: 'Frequency',
				labels: function (value, i, opt) {
					var str = value.toString();
					if (str[0] !== '2' && str[0] !== '1' && str[0] !== '5') return null;
					return opt.titles[i];
				}
			}]
		});

		this.on('resize', () => {
			if (this.isPlannedGridUpdate) return;
			this.isPlannedGridUpdate = true;
			this.once('render', () => {
				this.isPlannedGridUpdate = false;
				this.gridComponent.update();
			});
		});
	}
	else {

	}

	this.setFill(this.fill);

	this.container.style.color = 'white';
};
