export default class GpuBufferManager {
	constructor(viewer) {
		this.viewer = viewer;
		this.gl = this.viewer.gl;
		this.settings = this.viewer.settings;
		
		this.liveBuffersTransparent = [];
		this.liveBuffersOpaque = [];
		this.liveReusedBuffers = [];
	}
	
	isEmpty() {
		return 
			(this.liveBuffersOpaque == null || this.liveBuffersOpaque.length == 0) && 
			(this.liveBuffersTransparent == null || this.liveBuffersTransparent.length == 0) &&
			(this.liveBuffersReuse == null || this.liveBuffersReuse.length == 0);
	}
	
	getBuffers(transparency, reuse) {
		if (reuse) {
			return this.liveReusedBuffers;
		}
		if (transparency) {
			return this.liveBuffersTransparent;
		} else {
			return this.liveBuffersOpaque;
		}
	}
	
	pushBuffer(buffer) {
		if (buffer.reuse) {
			this.liveReuseBuffers.push(buffer);
		} else {
			if (buffer.hasTransparency) {
				this.liveBuffersTransparent.push(buffer);
			} else {
				this.liveBuffersOpaque.push(buffer);
			}
		}
	}
	
	sortAllBuffers() {
		this.sortBuffers(this.liveBuffersOpaque);
		this.sortBuffers(this.liveBuffersTransparent);
		this.sortBuffers(this.liveReusedBuffers);
	}
	
	sortBuffers(buffers) {
		buffers.sort((a, b) => {
			for (var i=0; i<4; i++) {
				if (a.color[i] == b.color[i]) {
					continue;
				}
				return a.color[i] - b.color[i];
			}
			// Colors are the same
			return 0;
		});
	}
	
	combineBuffers() {
		for (var transparency of [false, true]) {
			var buffers = this.getBuffers(transparency, false);
			
			// This is only done when useObjectColors is false for now, probably because that's going to be the default anyways
			
			if (buffers.length > 1 && !this.viewer.settings.useObjectColors) {
				console.log("Combining buffers", buffers.length);
				
				var nrPositions = 0;
				var nrNormals = 0;
				var nrIndices = 0;
				var nrColors = 0;
				
				for (var buffer of buffers) {
					nrPositions += buffer.nrPositions;
					nrNormals += buffer.nrNormals;
					nrIndices += buffer.nrIndices;
					nrColors += buffer.nrColors;
				}
				
				const positionBuffer = this.gl.createBuffer();
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
				this.gl.bufferData(this.gl.ARRAY_BUFFER, this.settings.quantizeVertices ? new Int16Array(nrPositions) : new Float32Array(nrPositions), this.gl.STATIC_DRAW);
				
				const normalBuffer = this.gl.createBuffer();
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, normalBuffer);
				this.gl.bufferData(this.gl.ARRAY_BUFFER, this.settings.quantizeNormals ? new Int8Array(nrNormals) : new Float32Array(nrNormals), this.gl.STATIC_DRAW);

				var colorBuffer = this.gl.createBuffer();
				this.gl.bindBuffer(this.gl.ARRAY_BUFFER, colorBuffer);
				this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(nrColors), this.gl.STATIC_DRAW);
				
				const indexBuffer = this.gl.createBuffer();
				this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
				this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, new Int32Array(nrIndices), this.gl.STATIC_DRAW);
				
				var positionsOffset = 0;
				var normalsOffset = 0;
				var indicesOffset = 0;
				var colorsOffset = 0;

				for (var buffer of buffers) {
					this.gl.bindBuffer(this.gl.COPY_READ_BUFFER, buffer.positionBuffer);
					this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
					this.gl.copyBufferSubData(this.gl.COPY_READ_BUFFER, this.gl.ARRAY_BUFFER, 0, positionsOffset * (this.settings.quantizeVertices ? 2 : 4), buffer.nrPositions * (this.settings.quantizeVertices ? 2 : 4));
					
					this.gl.bindBuffer(this.gl.COPY_READ_BUFFER, buffer.normalBuffer);
					this.gl.bindBuffer(this.gl.ARRAY_BUFFER, normalBuffer);
					this.gl.copyBufferSubData(this.gl.COPY_READ_BUFFER, this.gl.ARRAY_BUFFER, 0, normalsOffset * (this.settings.quantizeNormals ? 1 : 4), buffer.nrNormals * (this.settings.quantizeNormals ? 1 : 4));

					this.gl.bindBuffer(this.gl.COPY_READ_BUFFER, buffer.colorBuffer);
					this.gl.bindBuffer(this.gl.ARRAY_BUFFER, colorBuffer);
					this.gl.copyBufferSubData(this.gl.COPY_READ_BUFFER, this.gl.ARRAY_BUFFER, 0, colorsOffset * 4, buffer.nrColors * 4);

					if (positionsOffset == 0) {
						this.gl.bindBuffer(this.gl.COPY_READ_BUFFER, buffer.indexBuffer);
						this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
						this.gl.copyBufferSubData(this.gl.COPY_READ_BUFFER, this.gl.ELEMENT_ARRAY_BUFFER, 0, 0, buffer.nrIndices * 4);
					} else {
						var startIndex = positionsOffset / 3;
						
						this.gl.bindBuffer(this.gl.COPY_READ_BUFFER, buffer.indexBuffer);
						var tmpIndexBuffer = new Int32Array(buffer.nrIndices);
						this.gl.getBufferSubData(this.gl.COPY_READ_BUFFER, 0, tmpIndexBuffer, 0, buffer.nrIndices);
						
						for (var i=0; i<buffer.nrIndices; i++) {
							tmpIndexBuffer[i] = tmpIndexBuffer[i] + startIndex;
						}
						
						this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
						this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, indicesOffset * 4, tmpIndexBuffer, 0, buffer.nrIndices);
					}

					this.gl.deleteBuffer(buffer.positionBuffer);
					this.gl.deleteBuffer(buffer.normalBuffer);
					this.gl.deleteBuffer(buffer.colorBuffer);
					this.gl.deleteBuffer(buffer.indexBuffer);
					
					this.gl.deleteVertexArray(buffer.vao);
					
					positionsOffset += buffer.nrPositions;
					normalsOffset += buffer.nrNormals;
					indicesOffset += buffer.nrIndices;
					colorsOffset += buffer.nrColors;
				}
				
				var programInfo = this.viewer.programManager.getProgram({
					instancing: false,
					useObjectColors: this.settings.useObjectColors,
					quantizeNormals: this.settings.quantizeNormals,
					quantizeVertices: this.settings.quantizeVertices
				});
				
				var vao = this.gl.createVertexArray();
				this.gl.bindVertexArray(vao);

				{
					const numComponents = 3;
					const normalize = false;
					const stride = 0;
					const offset = 0;
					this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
					if (this.settings.quantizeVertices) {
						this.gl.vertexAttribIPointer(programInfo.attribLocations.vertexPosition, numComponents, this.gl.SHORT, normalize, stride, offset);
					} else {
						this.gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, numComponents, this.gl.FLOAT, normalize, stride, offset);
					}
					this.gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);
				}
				{
					const numComponents = 3;
					const normalize = false;
					const stride = 0;
					const offset = 0;
					this.gl.bindBuffer(this.gl.ARRAY_BUFFER, normalBuffer);
					if (this.settings.quantizeNormals) {
						this.gl.vertexAttribIPointer(programInfo.attribLocations.vertexNormal, numComponents, this.gl.BYTE, normalize, stride, offset);
					} else {
						this.gl.vertexAttribPointer(programInfo.attribLocations.vertexNormal, numComponents, this.gl.FLOAT, normalize, stride, offset);
					}
					this.gl.enableVertexAttribArray(programInfo.attribLocations.vertexNormal);
				}
				{
					const numComponents = 4;
					const type = this.gl.FLOAT;
					const normalize = false;
					const stride = 0;
					const offset = 0;
					this.gl.bindBuffer(this.gl.ARRAY_BUFFER, colorBuffer);
					this.gl.vertexAttribPointer(programInfo.attribLocations.vertexColor, numComponents,	type, normalize, stride, offset);
					this.gl.enableVertexAttribArray(programInfo.attribLocations.vertexColor);
				}

				this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

				this.gl.bindVertexArray(null);
				
				var newBuffer = {
					positionBuffer: positionBuffer,
					normalBuffer: normalBuffer,
					indexBuffer: indexBuffer,
					colorBuffer: colorBuffer,
					nrIndices: indicesOffset,
					nrPositions: positionsOffset,
					nrNormals: normalsOffset,
					nrColors: colorsOffset,
					vao: vao,
					hasTransparency: transparency,
					reuse: false
				};
				
				var previousLength = buffers.length;
				buffers.length = 0;
				buffers.push(newBuffer);
				
				return previousLength - 1;
			}
		}
		return 0;
	}
}