var MAX_LAYERS = 128,
    dimPix = 0.4,
    layers = 7,
    tempoFactor = 0.1,
    coloring = 1,
    gui,
    canvas,
    gl,
    program,
    overlayProgram,
    vertexBuffer,
    sphereBuffer,
    sphereVertexCount = 0,
    overlayBuffer,
    overlayTexture,
    overlayCanvas,
    overlayContext,
    directionVectors = new Float32Array(MAX_LAYERS * 2),
    randomAngles = [],
    xrSession = null,
    xrReferenceSpace = null,
    xrSelectedControl = 0,
    xrNextAxisActionTime = 0,
    xrControlsVisible = true,
    xrToggleButtonPressed = false,
    overlayDirty = true,
    desktopFrameId = 0,
    startTime = performance.now(),
    uniforms = {},
    attributes = {},
    overlayUniforms = {},
    overlayAttributes = {},
    guiControllers = [],
    controls = {
        layers: 7,
        tempo: 0.1,
        dimPix: 0.4,
        coloring: 'Grayscale',
        angleMode: 'Evenly Spaced',
        quality: 1,
        distance: 2.4,
        scale: 2.8
    };

var xrControlDefs = [
    { key: 'layers', label: 'Layers', min: 1, max: 100, step: 1, decimals: 0 },
    { key: 'tempo', label: 'Tempo', min: 0.01, max: 0.5, step: 0.01, decimals: 2 },
    { key: 'dimPix', label: 'Density', min: 0.05, max: 2, step: 0.05, decimals: 2 },
    { key: 'coloring', label: 'Palette', values: ['Grayscale', 'Spectrum'] },
    { key: 'angleMode', label: 'Angles', values: ['Evenly Spaced', 'Random'] },
    { key: 'distance', label: 'Distance', min: 1.2, max: 4.5, step: 0.1, decimals: 1 },
    { key: 'scale', label: 'Scale', min: 1.4, max: 5, step: 0.1, decimals: 1 }
];

var previousAngleMode = controls.angleMode;

var IDENTITY_MATRIX = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
]);

document.addEventListener('DOMContentLoaded', init);

async function init() {
    canvas = document.getElementById('quasicrystals-canvas');
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, xrCompatible: true });

    if (!gl) {
        setStatus('WebGL is not available in this browser');
        return;
    }

    try {
        var shaderSources = await Promise.all([
            fetchText('js/quasicrystals.vert'),
            fetchText('js/quasicrystals.frag'),
            fetchText('js/xr-controls.vert'),
            fetchText('js/xr-controls.frag')
        ]);

        program = createProgram(shaderSources[0], shaderSources[1]);
        overlayProgram = createProgram(shaderSources[2], shaderSources[3]);
    } catch (error) {
        setStatus(error.message);
        return;
    }

    attributes.aPosition = gl.getAttribLocation(program, 'aPosition');
    attributes.aTexCoord = gl.getAttribLocation(program, 'aTexCoord');
    uniforms.uModelViewProjectionMatrix = gl.getUniformLocation(program, 'uModelViewProjectionMatrix');
    uniforms.uResolution = gl.getUniformLocation(program, 'uResolution');
    uniforms.uTime = gl.getUniformLocation(program, 'uTime');
    uniforms.uDimPix = gl.getUniformLocation(program, 'uDimPix');
    uniforms.uLayerCount = gl.getUniformLocation(program, 'uLayerCount');
    uniforms.uColoring = gl.getUniformLocation(program, 'uColoring');
    uniforms.uGeometry = gl.getUniformLocation(program, 'uGeometry');
    uniforms.uXRMode = gl.getUniformLocation(program, 'uXRMode');
    uniforms.uDirections = gl.getUniformLocation(program, 'uDirections');

    setupGeometry();
    setupXROverlay();
    setupGui();
    setupXR();
    syncParameters();
    window.addEventListener('resize', resizeRenderer);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', resizeRenderer);
        window.visualViewport.addEventListener('scroll', resizeRenderer);
    }
    resizeRenderer();
    startDesktopLoop();
}

async function fetchText(url) {
    var response = await fetch(url);

    if (!response.ok) {
        throw new Error('Could not load ' + url);
    }

    return response.text();
}

function createProgram(vertexSource, fragmentSource) {
    var vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
    var fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    var shaderProgram = gl.createProgram();

    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        throw new Error('Shader link failed: ' + gl.getProgramInfoLog(shaderProgram));
    }

    return shaderProgram;
}

function compileShader(type, source) {
    var shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(shader));
    }

    return shader;
}

function setupGeometry() {
    vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 0, 0, 0,
        1, -1, 0, 1, 0,
        -1, 1, 0, 0, 1,
        -1, 1, 0, 0, 1,
        1, -1, 0, 1, 0,
        1, 1, 0, 1, 1
    ]), gl.STATIC_DRAW);

    var sphereData = createSphereGeometry(64, 32);

    sphereVertexCount = sphereData.length / 5;
    sphereBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sphereData, gl.STATIC_DRAW);
}

function createSphereGeometry(longitudeSegments, latitudeSegments) {
    var vertices = [];

    for (var lat = 0; lat < latitudeSegments; lat++) {
        var v0 = lat / latitudeSegments;
        var v1 = (lat + 1) / latitudeSegments;
        var theta0 = v0 * Math.PI;
        var theta1 = v1 * Math.PI;

        for (var lon = 0; lon < longitudeSegments; lon++) {
            var u0 = lon / longitudeSegments;
            var u1 = (lon + 1) / longitudeSegments;
            var phi0 = u0 * Math.PI * 2;
            var phi1 = u1 * Math.PI * 2;

            pushSphereVertex(vertices, theta0, phi0, u0, v0);
            pushSphereVertex(vertices, theta1, phi0, u0, v1);
            pushSphereVertex(vertices, theta0, phi1, u1, v0);
            pushSphereVertex(vertices, theta0, phi1, u1, v0);
            pushSphereVertex(vertices, theta1, phi0, u0, v1);
            pushSphereVertex(vertices, theta1, phi1, u1, v1);
        }
    }

    return new Float32Array(vertices);
}

function pushSphereVertex(vertices, theta, phi, u, v) {
    var sinTheta = Math.sin(theta);
    var x = sinTheta * Math.sin(phi);
    var y = Math.cos(theta);
    var z = sinTheta * Math.cos(phi);

    vertices.push(x, y, z, u, v);
}

function setupXROverlay() {
    overlayAttributes.aPosition = gl.getAttribLocation(overlayProgram, 'aPosition');
    overlayAttributes.aTexCoord = gl.getAttribLocation(overlayProgram, 'aTexCoord');
    overlayUniforms.uModelViewProjectionMatrix = gl.getUniformLocation(overlayProgram, 'uModelViewProjectionMatrix');
    overlayUniforms.uTexture = gl.getUniformLocation(overlayProgram, 'uTexture');

    overlayBuffer = gl.createBuffer();
    overlayTexture = gl.createTexture();
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 768;
    overlayCanvas.height = 512;
    overlayContext = overlayCanvas.getContext('2d');

    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

function setupGui() {
    if (!window.lil || !window.lil.GUI) {
        return;
    }

    gui = new lil.GUI({ title: 'Parameters' });
    guiControllers.push(gui.add(controls, 'layers', 1, 100, 1).name('Layers').onChange(syncParameters));
    guiControllers.push(gui.add(controls, 'tempo', 0.01, 0.5, 0.01).name('Tempo').onChange(syncParameters));
    guiControllers.push(gui.add(controls, 'dimPix', 0.05, 2.0, 0.05).name('Pattern Density').onChange(syncParameters));
    guiControllers.push(gui.add(controls, 'coloring', ['Grayscale', 'Spectrum']).name('Palette').onChange(syncParameters));
    guiControllers.push(gui.add(controls, 'angleMode', ['Evenly Spaced', 'Random']).name('Angle Mode').onChange(syncParameters));
    guiControllers.push(gui.add(controls, 'quality', 0.5, 1.0, 0.05).name('Render Scale').onChange(syncParameters));

    var referencesPanel = document.getElementById('references-panel');

    if (referencesPanel) {
        referencesPanel.classList.add('is-mounted');
        gui.domElement.appendChild(referencesPanel);
    }
}

function setupXR() {
    var xrButton = document.getElementById('xr-button');
    var xrCloseButton = document.getElementById('xr-close-button');

    xrButton.addEventListener('click', toggleXR);
    xrCloseButton.addEventListener('click', closeXRPanel);

    if (!navigator.xr) {
        setStatus('WebXR requires a compatible browser and headset');
        return;
    }

    navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
        xrButton.disabled = !supported;
        setStatus(supported ? 'WebXR ready' : 'Immersive VR is not available');
    }).catch(function () {
        xrButton.disabled = true;
        setStatus('Could not check WebXR support');
    });
}

function syncParameters() {
    layers = controls.layers;
    tempoFactor = controls.tempo;
    dimPix = controls.dimPix;
    coloring = controls.coloring === 'Spectrum' ? 2 : 1;

    if (controls.angleMode !== previousAngleMode) {
        previousAngleMode = controls.angleMode;

        if (controls.angleMode === 'Random') {
            rebuildRandomAngles();
        }
    }

    rebuildLayerDirections();
    overlayDirty = true;
    resizeRenderer();
}

function refreshGui() {
    for (var i = 0; i < guiControllers.length; i++) {
        guiControllers[i].updateDisplay();
    }
}

function selectNextXRControl() {
    xrSelectedControl = (xrSelectedControl + 1) % xrControlDefs.length;
    overlayDirty = true;
}

function selectPreviousXRControl() {
    xrSelectedControl = (xrSelectedControl + xrControlDefs.length - 1) % xrControlDefs.length;
    overlayDirty = true;
}

function adjustSelectedXRControl(direction) {
    var definition = xrControlDefs[xrSelectedControl];
    var currentValue = controls[definition.key];

    if (definition.values) {
        var currentIndex = definition.values.indexOf(currentValue);
        var nextIndex = currentIndex + direction;

        if (nextIndex < 0) {
            nextIndex = definition.values.length - 1;
        } else if (nextIndex >= definition.values.length) {
            nextIndex = 0;
        }

        controls[definition.key] = definition.values[nextIndex];
    } else {
        var precision = Math.pow(10, definition.decimals || 0);
        var nextValue = currentValue + definition.step * direction;

        nextValue = Math.max(definition.min, Math.min(definition.max, nextValue));
        controls[definition.key] = Math.round(nextValue * precision) / precision;
    }

    syncParameters();
    refreshGui();
}

function formatXRControlValue(definition) {
    var value = controls[definition.key];

    if (definition.values) {
        return value;
    }

    return value.toFixed(definition.decimals || 0);
}

function rebuildRandomAngles() {
    randomAngles = [];

    for (var i = 0; i < MAX_LAYERS; i++) {
        randomAngles.push(Math.random() * Math.PI);
    }
}

function rebuildLayerDirections() {
    var orientationDelta = Math.PI / layers;

    if (controls.angleMode === 'Random' && randomAngles.length < MAX_LAYERS) {
        rebuildRandomAngles();
    }

    for (var i = 0; i < MAX_LAYERS; i++) {
        if (i < layers) {
            var orientation = controls.angleMode === 'Random' ? randomAngles[i] : i * orientationDelta;

            directionVectors[i * 2] = Math.cos(orientation);
            directionVectors[i * 2 + 1] = Math.sin(orientation);
        } else {
            directionVectors[i * 2] = 0;
            directionVectors[i * 2 + 1] = 0;
        }
    }
}

function resizeRenderer() {
    if (!canvas || xrSession) {
        return;
    }

    var viewport = getViewportSize();
    var renderWidth = Math.max(1, Math.floor(viewport.width * controls.quality));
    var renderHeight = Math.max(1, Math.floor(viewport.height * controls.quality));
    var styleWidth = viewport.width + 'px';
    var styleHeight = viewport.height + 'px';

    if (canvas.width !== renderWidth) {
        canvas.width = renderWidth;
    }

    if (canvas.height !== renderHeight) {
        canvas.height = renderHeight;
    }

    if (canvas.style.width !== styleWidth) {
        canvas.style.width = styleWidth;
    }

    if (canvas.style.height !== styleHeight) {
        canvas.style.height = styleHeight;
    }

    gl.viewport(0, 0, renderWidth, renderHeight);
}

function getViewportSize() {
    if (window.visualViewport) {
        return {
            width: window.visualViewport.width,
            height: window.visualViewport.height
        };
    }

    return {
        width: window.innerWidth,
        height: window.innerHeight
    };
}

function startDesktopLoop() {
    if (!desktopFrameId) {
        desktopFrameId = window.requestAnimationFrame(drawDesktopFrame);
    }
}

function stopDesktopLoop() {
    if (desktopFrameId) {
        window.cancelAnimationFrame(desktopFrameId);
        desktopFrameId = 0;
    }
}

function drawDesktopFrame(time) {
    renderView(0, 0, canvas.width, canvas.height, IDENTITY_MATRIX, time);
    desktopFrameId = window.requestAnimationFrame(drawDesktopFrame);
}

async function toggleXR() {
    if (xrSession) {
        await xrSession.end();
        return;
    }

    try {
        var session = await navigator.xr.requestSession('immersive-vr');
        await startXRSession(session);
    } catch (error) {
        setStatus('Could not enter VR');
    }
}

async function closeXRPanel() {
    if (xrSession) {
        await xrSession.end();
    }

    document.getElementById('xr-panel').hidden = true;
}

async function startXRSession(session) {
    xrSession = session;
    stopDesktopLoop();
    setStatus('WebXR session running');
    document.getElementById('xr-button').textContent = 'Exit VR';

    xrSession.addEventListener('end', endXRSession);
    xrSession.addEventListener('select', selectNextXRControl);
    xrSession.addEventListener('squeeze', selectPreviousXRControl);
    await gl.makeXRCompatible();

    xrSession.updateRenderState({
        baseLayer: new XRWebGLLayer(xrSession, gl, {
            framebufferScaleFactor: controls.quality
        })
    });

    xrReferenceSpace = await xrSession.requestReferenceSpace('local');
    xrSession.requestAnimationFrame(drawXRFrame);
}

function endXRSession() {
    xrSession.removeEventListener('end', endXRSession);
    xrSession.removeEventListener('select', selectNextXRControl);
    xrSession.removeEventListener('squeeze', selectPreviousXRControl);
    xrSession = null;
    xrReferenceSpace = null;
    document.getElementById('xr-button').textContent = 'Enter VR';
    setStatus('WebXR ready');
    resizeRenderer();
    startDesktopLoop();
}

function drawXRFrame(time, frame) {
    var session = frame.session;
    var pose = frame.getViewerPose(xrReferenceSpace);

    session.requestAnimationFrame(drawXRFrame);
    pollXRInput(session, time);

    if (!pose) {
        return;
    }

    var layer = session.renderState.baseLayer;

    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);

    for (var i = 0; i < pose.views.length; i++) {
        var view = pose.views[i];
        var viewport = layer.getViewport(view);
        var model = createSphereModelMatrix(controls.distance);
        var viewModel = multiplyMatrix(view.transform.inverse.matrix, model);
        var mvp = multiplyMatrix(view.projectionMatrix, viewModel);
        var panelModel = multiplyMatrix(pose.transform.matrix, createPanelMatrix());
        var panelViewModel = multiplyMatrix(view.transform.inverse.matrix, panelModel);
        var panelMvp = multiplyMatrix(view.projectionMatrix, panelViewModel);

        renderView(viewport.x, viewport.y, viewport.width, viewport.height, mvp, time, true);

        if (xrControlsVisible) {
            renderXROverlay(viewport.x, viewport.y, viewport.width, viewport.height, panelMvp);
        }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function pollXRInput(session, time) {
    var axis = 0;
    var togglePressed = false;

    for (var sourceIndex = 0; sourceIndex < session.inputSources.length; sourceIndex++) {
        var source = session.inputSources[sourceIndex];

        if (!source.gamepad) {
            continue;
        }

        if (source.gamepad.axes) {
            for (var i = 0; i < source.gamepad.axes.length; i++) {
                if (Math.abs(source.gamepad.axes[i]) > Math.abs(axis)) {
                    axis = source.gamepad.axes[i];
                }
            }
        }

        if (source.gamepad.buttons) {
            for (var buttonIndex = 2; buttonIndex < source.gamepad.buttons.length; buttonIndex++) {
                if (source.gamepad.buttons[buttonIndex].pressed) {
                    togglePressed = true;
                }
            }
        }
    }

    if (togglePressed && !xrToggleButtonPressed) {
        toggleXRControls();
    }

    xrToggleButtonPressed = togglePressed;

    if (Math.abs(axis) < 0.65 || time < xrNextAxisActionTime) {
        return;
    }

    adjustSelectedXRControl(axis > 0 ? 1 : -1);
    xrNextAxisActionTime = time + 180;
}

function toggleXRControls() {
    xrControlsVisible = !xrControlsVisible;
    overlayDirty = true;
}

function createModelMatrix(scale, distance) {
    return new Float32Array([
        scale, 0, 0, 0,
        0, scale, 0, 0,
        0, 0, scale, 0,
        0, 0, -distance, 1
    ]);
}

function createSphereModelMatrix(radius) {
    return new Float32Array([
        radius, 0, 0, 0,
        0, radius, 0, 0,
        0, 0, radius, 0,
        0, 0, 0, 1
    ]);
}

function createPanelMatrix() {
    return new Float32Array([
        0.78, 0, 0, 0,
        0, 0.46, 0, 0,
        0, 0, 1, 0,
        0, 0, -1.8, 1
    ]);
}

function multiplyMatrix(a, b) {
    var result = new Float32Array(16);

    for (var column = 0; column < 4; column++) {
        for (var row = 0; row < 4; row++) {
            result[column * 4 + row] =
                a[0 * 4 + row] * b[column * 4 + 0] +
                a[1 * 4 + row] * b[column * 4 + 1] +
                a[2 * 4 + row] * b[column * 4 + 2] +
                a[3 * 4 + row] * b[column * 4 + 3];
        }
    }

    return result;
}

function renderView(x, y, width, height, mvp, time, xrSphere) {
    var buffer = xrSphere ? sphereBuffer : vertexBuffer;
    var vertexCount = xrSphere ? sphereVertexCount : 6;

    gl.viewport(x, y, width, height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, width, height);
    gl.clearColor(0.01, 0.02, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(attributes.aPosition);
    gl.vertexAttribPointer(attributes.aPosition, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(attributes.aTexCoord);
    gl.vertexAttribPointer(attributes.aTexCoord, 2, gl.FLOAT, false, 20, 12);
    gl.uniformMatrix4fv(uniforms.uModelViewProjectionMatrix, false, mvp);
    gl.uniform2f(uniforms.uResolution, width, height);
    gl.uniform1f(uniforms.uTime, ((time - startTime) / 16.6667) * tempoFactor);
    gl.uniform1f(uniforms.uDimPix, dimPix);
    gl.uniform1i(uniforms.uLayerCount, layers);
    gl.uniform1i(uniforms.uColoring, coloring);
    gl.uniform1i(uniforms.uGeometry, xrSphere ? 2 : 1);
    gl.uniform1i(uniforms.uXRMode, xrSphere ? 1 : 0);
    gl.uniform2fv(uniforms.uDirections, directionVectors);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
}

function renderXROverlay(x, y, width, height, mvp) {
    if (!overlayProgram || !overlayTexture) {
        return;
    }

    if (overlayDirty) {
        updateXROverlayTexture();
    }

    gl.viewport(x, y, width, height);
    gl.scissor(x, y, width, height);
    gl.useProgram(overlayProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, overlayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 0, 0, 0,
        1, -1, 0, 1, 0,
        -1, 1, 0, 0, 1,
        -1, 1, 0, 0, 1,
        1, -1, 0, 1, 0,
        1, 1, 0, 1, 1
    ]), gl.STREAM_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    gl.uniformMatrix4fv(overlayUniforms.uModelViewProjectionMatrix, false, mvp);
    gl.uniform1i(overlayUniforms.uTexture, 0);
    gl.enableVertexAttribArray(overlayAttributes.aPosition);
    gl.vertexAttribPointer(overlayAttributes.aPosition, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(overlayAttributes.aTexCoord);
    gl.vertexAttribPointer(overlayAttributes.aTexCoord, 2, gl.FLOAT, false, 20, 12);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
}

function updateXROverlayTexture() {
    var context = overlayContext;
    var width = overlayCanvas.width;
    var height = overlayCanvas.height;

    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(2, 6, 23, 0.58)';
    roundRect(context, 0, 0, width, height, 28);
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    context.lineWidth = 2;
    context.stroke();

    context.fillStyle = '#f8fafc';
    context.font = '700 30px sans-serif';
    context.fillText('VR controls', 30, 44);

    context.fillStyle = '#cbd5e1';
    context.font = '20px sans-serif';
    context.fillText('Trigger: next   Grip: previous   Stick/pad: adjust', 30, 76);
    context.fillText('A/B/menu/stick press: hide/show panel', 30, 104);

    for (var i = 0; i < xrControlDefs.length; i++) {
        drawXRControlRow(context, xrControlDefs[i], i);
    }

    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, overlayCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    overlayDirty = false;
}

function drawXRControlRow(context, definition, index) {
    var rowTop = 138 + index * 43;
    var selected = index === xrSelectedControl;

    if (selected) {
        context.fillStyle = 'rgba(96, 165, 250, 0.28)';
        roundRect(context, 20, rowTop - 29, 728, 36, 12);
        context.fill();
        context.strokeStyle = 'rgba(191, 219, 254, 0.78)';
        context.lineWidth = 2;
        context.stroke();
    }

    context.fillStyle = selected ? '#ffffff' : '#e2e8f0';
    context.font = selected ? '700 24px sans-serif' : '500 23px sans-serif';
    context.fillText(definition.label, 36, rowTop);

    context.textAlign = 'right';
    context.fillStyle = selected ? '#dbeafe' : '#cbd5e1';
    context.fillText(formatXRControlValue(definition), 724, rowTop);
    context.textAlign = 'left';
}

function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
}

function setStatus(message) {
    var status = document.getElementById('xr-status');

    if (status) {
        status.textContent = message;
    }
}
