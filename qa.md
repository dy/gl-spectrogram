## Q: what is the principle of rendering?

1. Render freq slice shifted to output texture.
2. Render frequency slice to 1px viewport
3. Render texture to renderbuffer.
4. Swap input and output textures.

## Q: how do we render complete waveform?

1. setData(data) method, filling last texture with the data (slice).
	- but we need fftSize then, to recognize height. Or passing size in some fashion.
2. isolate `.render` method to `.push` or alike, where audio data rendering is unbound from the raf.
	+ that way, rendering full waveform is just a cycle of pushing freq slices, we don’t have to care about fftsize or etc
	+ that way, raf automatically binds spectrum to realtime.
	+ that way we avoid setting speed - it can be regulated by repeatable push, like push 10 times etc.
	+ smoothing starts making sense, providing that distance between pushed data is constant.
	+ that way we avoid playback API.