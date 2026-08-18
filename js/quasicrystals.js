let MAX_LAYERS = 128,
    ANIMATION_STORAGE_VERSION = 1,
    ANIMATION_STORAGE_KEY = 'hypnagogic-quasicrystals.animations',
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
    customAngles = [],
    customAngleCanvas,
    customAngleContext,
    customAngleDialog,
    saveAnimationDialog,
    saveAnimationForm,
    saveAnimationNameInput,
    loadAnimationDialog,
    savedAnimationList,
    customAngleDragIndex = -1,
    customAngleEditorPending = false,
    initialSyncPending = true,
    xrSession = null,
    xrReferenceSpace = null,
    xrSelectedControl = 0,
    xrNextAxisActionTime = 0,
    xrControlsVisible = true,
    xrToggleButtonPressed = false,
    overlayDirty = true,
    desktopFrameId = 0,
    startTime = performance.now(),
    paused = true,
    pausedAt = startTime,
    totalPausedTime = 0,
    uniforms = {},
    attributes = {},
    overlayUniforms = {},
    overlayAttributes = {},
    guiControllers = [],
    pauseButtonController,
    linkButtonController,
    controls = {
        layers: 7,
        tempo: 0.03,
        dimPix: 0.15,
        coloring: 'Grayscale',
        angleMode: 'Evenly Spaced',
        quality: 1,
        distance: 2.4,
        scale: 2.8
    };

let colorPalettes = ['Grayscale', 'Spectrum', 'Viridis', 'Plasma', 'Cividis', 'Turbo', 'Magma'];

let controlParamDefs = [
    { key: 'layers', min: 1, max: 100, step: 1, decimals: 0 },
    { key: 'tempo', min: 0.01, max: 0.5, step: 0.01, decimals: 2 },
    { key: 'dimPix', min: 0.05, max: 2, step: 0.05, decimals: 2 },
    { key: 'coloring', values: colorPalettes },
    { key: 'angleMode', values: ['Evenly Spaced', 'Random', 'Custom'] },
    { key: 'quality', min: 0.5, max: 1, step: 0.05, decimals: 2 },
    { key: 'distance', min: 1.2, max: 4.5, step: 0.1, decimals: 1 },
    { key: 'scale', min: 1.4, max: 5, step: 0.1, decimals: 1 }
];

let xrControlDefs = [
    { key: 'layers', label: 'Layers', min: 1, max: 100, step: 1, decimals: 0 },
    { key: 'tempo', label: 'Tempo', min: 0.01, max: 0.5, step: 0.01, decimals: 2 },
    { key: 'dimPix', label: 'Density', min: 0.05, max: 2, step: 0.05, decimals: 2 },
    { key: 'coloring', label: 'Palette', values: colorPalettes },
    { key: 'angleMode', label: 'Angles', values: ['Evenly Spaced', 'Random'] },
    { key: 'distance', label: 'Distance', min: 1.2, max: 4.5, step: 0.1, decimals: 1 },
    { key: 'scale', label: 'Scale', min: 1.4, max: 5, step: 0.1, decimals: 1 }
];

let previousAngleMode = controls.angleMode;
let previousLayerCount = controls.layers;

let IDENTITY_MATRIX = new Float32Array([
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
        let shaderSources = await Promise.all([
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
    applyControlQueryParameters();
    setupGui();
    setupCustomAngleEditor();
    setupAnimationStorage();
    setupPhotosensitiveWarning();
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

function setupPhotosensitiveWarning() {
    let dialog = document.getElementById('photosensitive-warning');
    let button = document.getElementById('photosensitive-warning-button');

    if (!dialog || !button) {
        return;
    }

    button.addEventListener('click', acceptPhotosensitiveWarning);

    if (dialog.showModal) {
        dialog.showModal();
    } else {
        dialog.setAttribute('open', '');
    }
}

function acceptPhotosensitiveWarning() {
    let dialog = document.getElementById('photosensitive-warning');

    if (dialog && dialog.close) {
        dialog.close();
    } else if (dialog) {
        dialog.removeAttribute('open');
    }

    if (paused) {
        togglePaused();
    }

    if (customAngleEditorPending && controls.angleMode === 'Custom') {
        customAngleEditorPending = false;
        openCustomAngleEditor();
    }
}

async function fetchText(url) {
    let response = await fetch(url);

    if (!response.ok) {
        throw new Error('Could not load ' + url);
    }

    return response.text();
}

function createProgram(vertexSource, fragmentSource) {
    let vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
    let fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    let shaderProgram = gl.createProgram();

    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        throw new Error('Shader link failed: ' + gl.getProgramInfoLog(shaderProgram));
    }

    return shaderProgram;
}

function compileShader(type, source) {
    let shader = gl.createShader(type);

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

    let sphereData = createSphereGeometry(64, 32);

    sphereVertexCount = sphereData.length / 5;
    sphereBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sphereData, gl.STATIC_DRAW);
}

function createSphereGeometry(longitudeSegments, latitudeSegments) {
    let vertices = [];

    for (let lat = 0; lat < latitudeSegments; lat++) {
        let v0 = lat / latitudeSegments;
        let v1 = (lat + 1) / latitudeSegments;
        let theta0 = v0 * Math.PI;
        let theta1 = v1 * Math.PI;

        for (let lon = 0; lon < longitudeSegments; lon++) {
            let u0 = lon / longitudeSegments;
            let u1 = (lon + 1) / longitudeSegments;
            let phi0 = u0 * Math.PI * 2;
            let phi1 = u1 * Math.PI * 2;

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
    let sinTheta = Math.sin(theta);
    let x = sinTheta * Math.sin(phi);
    let y = Math.cos(theta);
    let z = sinTheta * Math.cos(phi);

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

    let linkActions = {
        togglePaused: togglePaused,
        createLink: createControlLink,
        saveAnimation: openSaveAnimationDialog,
        loadAnimation: openLoadAnimationDialog
    };

    gui = new lil.GUI({ title: 'Parameters' });
    guiControllers.push(gui.add(controls, 'layers', 1, 100, 1).name('Layers').onChange(syncParameters));
    guiControllers.push(gui.add(controls, 'tempo', 0.01, 0.5, 0.01).name('Tempo').onChange(syncParameters));
    guiControllers.push(gui.add(controls, 'dimPix', 0.05, 2.0, 0.05).name('Pattern Density').onChange(syncParameters));
    guiControllers.push(gui.add(controls, 'coloring', colorPalettes).name('Palette').onChange(syncParameters));
    guiControllers.push(gui.add(controls, 'angleMode', ['Evenly Spaced', 'Random', 'Custom']).name('Angle Mode').onChange(syncParameters));
    guiControllers.push(gui.add(controls, 'quality', 0.5, 1.0, 0.05).name('Render Scale').onChange(syncParameters));
    pauseButtonController = gui.add(linkActions, 'togglePaused').name('Pause');
    updatePauseButtonLabel();
    linkButtonController = gui.add(linkActions, 'createLink').name('Create link');
    gui.add(linkActions, 'saveAnimation').name('Save in browser storage');
    gui.add(linkActions, 'loadAnimation').name('Load from browser storage');

    let referencesPanel = document.getElementById('references-panel');

    if (referencesPanel) {
        referencesPanel.classList.add('is-mounted');
        gui.domElement.appendChild(referencesPanel);
    }
}

function setupCustomAngleEditor() {
    customAngleDialog = document.getElementById('custom-angle-modal');
    customAngleCanvas = document.getElementById('custom-angle-canvas');

    if (!customAngleDialog || !customAngleCanvas) {
        return;
    }

    customAngleContext = customAngleCanvas.getContext('2d');
    customAngleCanvas.addEventListener('pointerdown', startCustomAngleDrag);
    customAngleCanvas.addEventListener('pointermove', moveCustomAngleDrag);
    customAngleCanvas.addEventListener('pointerup', endCustomAngleDrag);
    customAngleCanvas.addEventListener('pointercancel', endCustomAngleDrag);
    customAngleCanvas.addEventListener('lostpointercapture', endCustomAngleDrag);
    customAngleDialog.addEventListener('close', function () {
        customAngleDragIndex = -1;
    });
    drawCustomAngleEditor();
}

function setupAnimationStorage() {
    saveAnimationDialog = document.getElementById('save-animation-modal');
    saveAnimationForm = document.getElementById('save-animation-form');
    saveAnimationNameInput = document.getElementById('save-animation-name');
    loadAnimationDialog = document.getElementById('load-animation-modal');
    savedAnimationList = document.getElementById('saved-animation-list');

    if (saveAnimationForm) {
        saveAnimationForm.addEventListener('submit', saveCurrentAnimation);
    }

    document.querySelectorAll('[data-close-modal]').forEach(function (button) {
        button.addEventListener('click', function () {
            closeDialog(button.closest('dialog'));
        });
    });
}

function setupXR() {
    let xrButton = document.getElementById('xr-button');
    let xrCloseButton = document.getElementById('xr-close-button');

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

function applyControlQueryParameters() {
    if (!window.URLSearchParams) {
        return;
    }

    applyControlParams(new URLSearchParams(window.location.search));
}

function applyControlParams(params) {
    for (let i = 0; i < controlParamDefs.length; i++) {
        let definition = controlParamDefs[i];

        if (!params.has(definition.key)) {
            continue;
        }

        let parsedValue = parseControlParam(definition, params.get(definition.key));

        if (parsedValue !== null) {
            controls[definition.key] = parsedValue;
        }
    }

    applyAngleQueryParameters(params);
}

function applyAngleQueryParameters(params) {
    if (!params.has('angles')) {
        return;
    }

    let parsedAngles = parseAngleList(params.get('angles'));

    if (parsedAngles.length < controls.layers) {
        return;
    }

    if (controls.angleMode === 'Random') {
        randomAngles = parsedAngles.slice(0, MAX_LAYERS);
    } else if (controls.angleMode === 'Custom') {
        customAngles = parsedAngles.slice(0, controls.layers);
    }
}

function parseControlParam(definition, rawValue) {
    if (definition.values) {
        return definition.values.indexOf(rawValue) !== -1 ? rawValue : null;
    }

    if (rawValue === null || rawValue.trim() === '') {
        return null;
    }

    let value = Number(rawValue);

    if (!Number.isFinite(value) || value < definition.min || value > definition.max) {
        return null;
    }

    return roundControlValue(definition, value);
}

function createControlLink() {
    let url = buildControlUrl();

    copyText(url).then(function () {
        setStatus('Link copied to clipboard');
        flashLinkButton('Link copied');
    }).catch(function () {
        setStatus('Could not copy link');
        flashLinkButton('Copy failed');
    });
}

function buildControlUrl() {
    let url = new URL(window.location.href);
    let params = buildControlParams();

    url.search = params.toString();

    return url.toString();
}

function buildControlParams() {
    let params = new URLSearchParams();

    for (let i = 0; i < controlParamDefs.length; i++) {
        let definition = controlParamDefs[i];
        let value = controls[definition.key];

        if (!definition.values) {
            value = formatControlParam(definition, value);
        }

        params.set(definition.key, value);
    }

    if (controls.angleMode === 'Random') {
        ensureRandomAngles();
        params.set('angles', formatAngleList(randomAngles, controls.layers));
    } else if (controls.angleMode === 'Custom') {
        ensureCustomAngles();
        params.set('angles', formatAngleList(customAngles, controls.layers));
    }

    return params;
}

function openSaveAnimationDialog() {
    if (!saveAnimationDialog || !saveAnimationNameInput) {
        setStatus('Save dialog is not available');
        return;
    }

    saveAnimationNameInput.value = getNextAnimationName();

    if (saveAnimationDialog.showModal) {
        saveAnimationDialog.showModal();
    } else {
        saveAnimationDialog.setAttribute('open', '');
    }

    saveAnimationNameInput.focus();
    saveAnimationNameInput.select();
}

function openLoadAnimationDialog() {
    if (!loadAnimationDialog || !savedAnimationList) {
        setStatus('Load dialog is not available');
        return;
    }

    renderSavedAnimationList();

    if (loadAnimationDialog.showModal) {
        loadAnimationDialog.showModal();
    } else {
        loadAnimationDialog.setAttribute('open', '');
    }
}

function saveCurrentAnimation(event) {
    event.preventDefault();

    let name = saveAnimationNameInput.value.trim();

    if (name === '') {
        saveAnimationNameInput.focus();
        return;
    }

    let animations = readSavedAnimations();
    let params = buildControlParams();

    animations.push({
        id: createStorageId(),
        version: ANIMATION_STORAGE_VERSION,
        name: name,
        createdAt: new Date().toISOString(),
        params: paramsToObject(params)
    });

    if (!writeSavedAnimations(animations)) {
        return;
    }

    closeDialog(saveAnimationDialog);

    setStatus('Animation saved in browser storage');
}

function renderSavedAnimationList() {
    let animations = readSavedAnimations();

    savedAnimationList.replaceChildren();

    if (animations.length === 0) {
        let empty = document.createElement('p');

        empty.className = 'storage-modal__empty';
        empty.textContent = 'No saved animations in this browser.';
        savedAnimationList.appendChild(empty);
        return;
    }

    animations.sort(function (a, b) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

    for (let i = 0; i < animations.length; i++) {
        savedAnimationList.appendChild(createSavedAnimationRow(animations[i]));
    }
}

function createSavedAnimationRow(animation) {
    let row = document.createElement('div');
    let details = document.createElement('div');
    let title = document.createElement('p');
    let meta = document.createElement('p');
    let actions = document.createElement('div');
    let loadButton = document.createElement('button');
    let deleteButton = document.createElement('button');
    let versionLabel = 'version ' + animation.version;

    row.className = 'storage-modal__row';
    title.className = 'storage-modal__row-title';
    meta.className = 'storage-modal__meta';
    actions.className = 'storage-modal__row-actions';
    loadButton.className = 'storage-modal__button';
    deleteButton.className = 'storage-modal__button storage-modal__button--danger';

    title.textContent = animation.name || 'Untitled animation';

    if (animation.version < ANIMATION_STORAGE_VERSION) {
        versionLabel += ' ';
        let warning = document.createElement('span');

        warning.className = 'storage-modal__version-warning';
        warning.textContent = '(older than current version ' + ANIMATION_STORAGE_VERSION + ')';
        meta.textContent = formatStoredDate(animation.createdAt) + ' · ' + versionLabel;
        meta.appendChild(warning);
    } else if (animation.version > ANIMATION_STORAGE_VERSION) {
        versionLabel += ' ';
        let warning = document.createElement('span');

        warning.className = 'storage-modal__version-warning';
        warning.textContent = '(newer than current version ' + ANIMATION_STORAGE_VERSION + ')';
        meta.textContent = formatStoredDate(animation.createdAt) + ' · ' + versionLabel;
        meta.appendChild(warning);
    } else {
        meta.textContent = formatStoredDate(animation.createdAt) + ' · ' + versionLabel;
    }

    loadButton.type = 'button';
    loadButton.textContent = 'Load';
    loadButton.addEventListener('click', function () {
        loadSavedAnimation(animation.id);
    });

    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', function () {
        deleteSavedAnimation(animation.id);
    });

    details.appendChild(title);
    details.appendChild(meta);
    actions.appendChild(loadButton);
    actions.appendChild(deleteButton);
    row.appendChild(details);
    row.appendChild(actions);

    return row;
}

function loadSavedAnimation(id) {
    let animation = findSavedAnimation(id);

    if (!animation) {
        setStatus('Saved animation was not found');
        renderSavedAnimationList();
        return;
    }

    applyControlParams(objectToParams(animation.params));
    previousAngleMode = controls.angleMode;
    previousLayerCount = controls.layers;
    closeCustomAngleEditor();
    syncParameters();
    refreshGui();

    closeDialog(loadAnimationDialog);

    setStatus('Animation loaded from browser storage');
}

function deleteSavedAnimation(id) {
    let animations = readSavedAnimations().filter(function (animation) {
        return animation.id !== id;
    });

    if (writeSavedAnimations(animations)) {
        renderSavedAnimationList();
        setStatus('Saved animation deleted');
    }
}

function findSavedAnimation(id) {
    let animations = readSavedAnimations();

    for (let i = 0; i < animations.length; i++) {
        if (animations[i].id === id) {
            return animations[i];
        }
    }

    return null;
}

function getNextAnimationName() {
    let animations = readSavedAnimations();
    let usedNumbers = {};

    for (let i = 0; i < animations.length; i++) {
        let match = /^Animation ([1-9][0-9]*)$/.exec(animations[i].name || '');

        if (match) {
            usedNumbers[Number(match[1])] = true;
        }
    }

    for (let number = 1; number < 10000; number++) {
        if (!usedNumbers[number]) {
            return 'Animation ' + number;
        }
    }

    return 'Animation ' + (animations.length + 1);
}

function readSavedAnimations() {
    try {
        if (!window.localStorage) {
            return [];
        }

        let rawValue = window.localStorage.getItem(ANIMATION_STORAGE_KEY);
        let parsed = rawValue ? JSON.parse(rawValue) : [];

        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter(isValidSavedAnimation);
    } catch (error) {
        setStatus('Could not read browser storage');
        return [];
    }
}

function writeSavedAnimations(animations) {
    try {
        if (!window.localStorage) {
            setStatus('Browser storage is not available');
            return false;
        }

        window.localStorage.setItem(ANIMATION_STORAGE_KEY, JSON.stringify(animations));
        return true;
    } catch (error) {
        setStatus('Could not write browser storage');
        return false;
    }
}

function isValidSavedAnimation(animation) {
    return animation &&
        typeof animation.id === 'string' &&
        typeof animation.name === 'string' &&
        typeof animation.createdAt === 'string' &&
        typeof animation.version === 'number' &&
        animation.params &&
        typeof animation.params === 'object';
}

function createStorageId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function paramsToObject(params) {
    let object = {};

    params.forEach(function (value, key) {
        object[key] = value;
    });

    return object;
}

function objectToParams(object) {
    let params = new URLSearchParams();

    if (!object || typeof object !== 'object') {
        return params;
    }

    Object.keys(object).forEach(function (key) {
        params.set(key, String(object[key]));
    });

    return params;
}

function formatStoredDate(value) {
    let date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
        return 'Unknown date';
    }

    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function closeDialog(dialog) {
    if (!dialog) {
        return;
    }

    if (dialog.close) {
        dialog.close();
    } else {
        dialog.removeAttribute('open');
    }
}

function parseAngleList(rawValue) {
    if (!rawValue || rawValue.trim() === '') {
        return [];
    }

    let parts = rawValue.split(',');
    let angles = [];

    for (let i = 0; i < parts.length && i < MAX_LAYERS; i++) {
        let value = Number(parts[i]);

        if (!Number.isFinite(value)) {
            return [];
        }

        angles.push(normalizeLineAngle(value));
    }

    return angles;
}

function formatAngleList(angles, count) {
    let formatted = [];

    for (let i = 0; i < count; i++) {
        formatted.push(normalizeLineAngle(angles[i] || 0).toFixed(6));
    }

    return formatted.join(',');
}

function formatControlParam(definition, value) {
    return roundControlValue(definition, value).toFixed(definition.decimals || 0);
}

function roundControlValue(definition, value) {
    let precision = Math.pow(10, definition.decimals || 0);

    return Math.round(value * precision) / precision;
}

function copyText(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
        return Promise.reject(new Error('Clipboard API is not available'));
    }

    return navigator.clipboard.writeText(text);
}

function flashLinkButton(label) {
    if (!linkButtonController) {
        return;
    }

    linkButtonController.name(label);

    window.setTimeout(function () {
        linkButtonController.name('Create link');
    }, 1400);
}

function togglePaused() {
    if (xrSession) {
        return;
    }

    if (paused) {
        totalPausedTime += performance.now() - pausedAt;
        paused = false;
        updatePauseButtonLabel();
        startDesktopLoop();
        return;
    }

    pausedAt = performance.now();
    paused = true;
    updatePauseButtonLabel();
    stopDesktopLoop();
    drawPausedDesktopFrame();
}

function updatePauseButtonLabel() {
    if (pauseButtonController) {
        pauseButtonController.name(paused ? 'Resume' : 'Pause');
    }
}

function syncParameters() {
    let layerCountChanged = controls.layers !== previousLayerCount;
    let shouldOpenCustomEditor = !initialSyncPending;

    if (!initialSyncPending && layerCountChanged && controls.angleMode === 'Custom') {
        controls.angleMode = 'Evenly Spaced';
        closeCustomAngleEditor();
        refreshGui();
    }

    layers = controls.layers;
    tempoFactor = controls.tempo;
    dimPix = controls.dimPix;
    coloring = Math.max(1, colorPalettes.indexOf(controls.coloring) + 1);

    if (controls.angleMode !== previousAngleMode) {
        if (controls.angleMode === 'Custom') {
            if (customAngles.length !== controls.layers) {
                initializeCustomAngles(previousAngleMode);
            }

            if (shouldOpenCustomEditor) {
                openCustomAngleEditor();
            }
        }

        previousAngleMode = controls.angleMode;

        if (controls.angleMode === 'Random') {
            if (shouldOpenCustomEditor || randomAngles.length < controls.layers) {
                rebuildRandomAngles();
            } else {
                ensureRandomAngles();
            }
        }
    }

    rebuildLayerDirections();
    previousLayerCount = controls.layers;
    initialSyncPending = false;
    overlayDirty = true;
    drawCustomAngleEditor();
    resizeRenderer();
}

function refreshGui() {
    for (let i = 0; i < guiControllers.length; i++) {
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
    let definition = xrControlDefs[xrSelectedControl];
    let currentValue = controls[definition.key];

    if (definition.values) {
        let currentIndex = definition.values.indexOf(currentValue);
        let nextIndex = currentIndex + direction;

        if (nextIndex < 0) {
            nextIndex = definition.values.length - 1;
        } else if (nextIndex >= definition.values.length) {
            nextIndex = 0;
        }

        controls[definition.key] = definition.values[nextIndex];
    } else {
        let nextValue = currentValue + definition.step * direction;

        nextValue = Math.max(definition.min, Math.min(definition.max, nextValue));
        controls[definition.key] = roundControlValue(definition, nextValue);
    }

    syncParameters();
    refreshGui();
}

function formatXRControlValue(definition) {
    let value = controls[definition.key];

    if (definition.values) {
        return value;
    }

    return value.toFixed(definition.decimals || 0);
}

function rebuildRandomAngles() {
    randomAngles = [];

    for (let i = 0; i < MAX_LAYERS; i++) {
        randomAngles.push(Math.random() * Math.PI);
    }
}

function ensureRandomAngles() {
    for (let i = randomAngles.length; i < MAX_LAYERS; i++) {
        randomAngles.push(Math.random() * Math.PI);
    }
}

function initializeCustomAngles(sourceMode) {
    let sourceAngles = [];

    if (sourceMode === 'Random') {
        ensureRandomAngles();
    }

    for (let i = 0; i < controls.layers; i++) {
        sourceAngles.push(getLayerAngle(i, sourceMode));
    }

    customAngles = sourceAngles;
}

function ensureCustomAngles() {
    if (customAngles.length === controls.layers) {
        return;
    }

    initializeCustomAngles('Evenly Spaced');
}

function openCustomAngleEditor() {
    if (!customAngleDialog) {
        return;
    }

    drawCustomAngleEditor();

    if (customAngleDialog.open) {
        return;
    }

    if (customAngleDialog.showModal) {
        try {
            customAngleDialog.showModal();
            customAngleEditorPending = false;
            return;
        } catch (error) {
            customAngleEditorPending = true;
            return;
        }
    }

    customAngleDialog.setAttribute('open', '');
    customAngleEditorPending = false;
}

function closeCustomAngleEditor() {
    customAngleEditorPending = false;
    customAngleDragIndex = -1;

    if (!customAngleDialog || !customAngleDialog.open) {
        return;
    }

    if (customAngleDialog.close) {
        customAngleDialog.close();
    } else {
        customAngleDialog.removeAttribute('open');
    }
}

function drawCustomAngleEditor() {
    if (!customAngleContext || !customAngleCanvas) {
        return;
    }

    let context = customAngleContext;
    let width = customAngleCanvas.width;
    let height = customAngleCanvas.height;
    let centerX = width / 2;
    let centerY = height / 2;
    let radius = Math.min(width, height) * 0.38;

    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(15, 23, 42, 0.82)';
    context.fillRect(0, 0, width, height);

    context.strokeStyle = 'rgba(226, 232, 240, 0.72)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();

    context.strokeStyle = 'rgba(148, 163, 184, 0.24)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(centerX - radius - 18, centerY);
    context.lineTo(centerX + radius + 18, centerY);
    context.moveTo(centerX, centerY - radius - 18);
    context.lineTo(centerX, centerY + radius + 18);
    context.stroke();

    if (controls.angleMode !== 'Custom') {
        return;
    }

    ensureCustomAngles();

    for (let i = 0; i < controls.layers; i++) {
        let angle = customAngles[i];
        let lineRadius = radius + (i === customAngleDragIndex ? 16 : 4);
        let x = Math.cos(angle) * lineRadius;
        let y = Math.sin(angle) * lineRadius;

        context.strokeStyle = getCustomAngleColor(i, i === customAngleDragIndex ? 0.98 : 0.72);
        context.lineWidth = i === customAngleDragIndex ? 4 : 2;
        context.beginPath();
        context.moveTo(centerX - x, centerY - y);
        context.lineTo(centerX + x, centerY + y);
        context.stroke();

        context.fillStyle = getCustomAngleColor(i, 0.95);
        context.beginPath();
        context.arc(centerX + x, centerY + y, i === customAngleDragIndex ? 7 : 5, 0, Math.PI * 2);
        context.fill();
    }
}

function getCustomAngleColor(index, alpha) {
    let hue = Math.round((index * 137.508) % 360);

    return 'hsla(' + hue + ', 84%, 66%, ' + alpha + ')';
}

function startCustomAngleDrag(event) {
    if (controls.angleMode !== 'Custom') {
        return;
    }

    customAngleDragIndex = getNearestCustomAngleIndex(event);

    if (customAngleDragIndex === -1) {
        return;
    }

    customAngleCanvas.setPointerCapture(event.pointerId);
    updateDraggedCustomAngle(event);
}

function moveCustomAngleDrag(event) {
    if (customAngleDragIndex === -1) {
        return;
    }

    updateDraggedCustomAngle(event);
}

function endCustomAngleDrag() {
    customAngleDragIndex = -1;
    drawCustomAngleEditor();
}

function updateDraggedCustomAngle(event) {
    let point = getCustomAngleCanvasPoint(event);
    let angle = Math.atan2(point.y - customAngleCanvas.height / 2, point.x - customAngleCanvas.width / 2);

    customAngles[customAngleDragIndex] = normalizeLineAngle(angle);
    rebuildLayerDirections();
    overlayDirty = true;
    drawCustomAngleEditor();

    if (paused && !xrSession) {
        drawPausedDesktopFrame();
    }
}

function getNearestCustomAngleIndex(event) {
    let point = getCustomAngleCanvasPoint(event);
    let angle = normalizeLineAngle(Math.atan2(point.y - customAngleCanvas.height / 2, point.x - customAngleCanvas.width / 2));
    let nearestIndex = -1;
    let nearestDistance = Infinity;

    ensureCustomAngles();

    for (let i = 0; i < controls.layers; i++) {
        let distance = getLineAngleDistance(angle, customAngles[i]);

        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = i;
        }
    }

    return nearestIndex;
}

function getCustomAngleCanvasPoint(event) {
    let rect = customAngleCanvas.getBoundingClientRect();

    return {
        x: (event.clientX - rect.left) * customAngleCanvas.width / rect.width,
        y: (event.clientY - rect.top) * customAngleCanvas.height / rect.height
    };
}

function normalizeLineAngle(angle) {
    let normalized = angle % Math.PI;

    return normalized < 0 ? normalized + Math.PI : normalized;
}

function getLineAngleDistance(a, b) {
    let distance = Math.abs(normalizeLineAngle(a) - normalizeLineAngle(b));

    return Math.min(distance, Math.PI - distance);
}

function getLayerAngle(index, mode) {
    if (mode === 'Random') {
        ensureRandomAngles();
        return randomAngles[index] || 0;
    }

    if (mode === 'Custom') {
        ensureCustomAngles();
        return customAngles[index] || 0;
    }

    return index * Math.PI / controls.layers;
}

function rebuildLayerDirections() {
    if (controls.angleMode === 'Random') {
        ensureRandomAngles();
    } else if (controls.angleMode === 'Custom') {
        ensureCustomAngles();
    }

    for (let i = 0; i < MAX_LAYERS; i++) {
        if (i < layers) {
            let orientation = getLayerAngle(i, controls.angleMode);

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

    let viewport = getViewportSize();
    let renderWidth = Math.max(1, Math.floor(viewport.width * controls.quality));
    let renderHeight = Math.max(1, Math.floor(viewport.height * controls.quality));
    let styleWidth = viewport.width + 'px';
    let styleHeight = viewport.height + 'px';

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

    if (paused) {
        drawPausedDesktopFrame();
    }
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
    if (!desktopFrameId && !paused) {
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
    renderView(0, 0, canvas.width, canvas.height, IDENTITY_MATRIX, getDesktopAnimationTime(time));
    desktopFrameId = window.requestAnimationFrame(drawDesktopFrame);
}

function drawPausedDesktopFrame() {
    if (!canvas || xrSession) {
        return;
    }

    renderView(0, 0, canvas.width, canvas.height, IDENTITY_MATRIX, getDesktopAnimationTime(pausedAt));
}

function getDesktopAnimationTime(time) {
    return time - totalPausedTime;
}

async function toggleXR() {
    if (xrSession) {
        await xrSession.end();
        return;
    }

    try {
        let session = await navigator.xr.requestSession('immersive-vr');
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
    if (controls.angleMode === 'Custom') {
        controls.angleMode = 'Evenly Spaced';
        previousAngleMode = controls.angleMode;
        closeCustomAngleEditor();
        refreshGui();
        rebuildLayerDirections();
    }

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
    let session = frame.session;
    let pose = frame.getViewerPose(xrReferenceSpace);

    session.requestAnimationFrame(drawXRFrame);
    pollXRInput(session, time);

    if (!pose) {
        return;
    }

    let layer = session.renderState.baseLayer;

    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);

    for (let i = 0; i < pose.views.length; i++) {
        let view = pose.views[i];
        let viewport = layer.getViewport(view);
        let model = createSphereModelMatrix(controls.distance);
        let viewModel = multiplyMatrix(view.transform.inverse.matrix, model);
        let mvp = multiplyMatrix(view.projectionMatrix, viewModel);
        let panelModel = multiplyMatrix(pose.transform.matrix, createPanelMatrix());
        let panelViewModel = multiplyMatrix(view.transform.inverse.matrix, panelModel);
        let panelMvp = multiplyMatrix(view.projectionMatrix, panelViewModel);

        renderView(viewport.x, viewport.y, viewport.width, viewport.height, mvp, time, true);

        if (xrControlsVisible) {
            renderXROverlay(viewport.x, viewport.y, viewport.width, viewport.height, panelMvp);
        }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function pollXRInput(session, time) {
    let axis = 0;
    let togglePressed = false;

    for (let sourceIndex = 0; sourceIndex < session.inputSources.length; sourceIndex++) {
        let source = session.inputSources[sourceIndex];

        if (!source.gamepad) {
            continue;
        }

        if (source.gamepad.axes) {
            for (let i = 0; i < source.gamepad.axes.length; i++) {
                if (Math.abs(source.gamepad.axes[i]) > Math.abs(axis)) {
                    axis = source.gamepad.axes[i];
                }
            }
        }

        if (source.gamepad.buttons) {
            for (let buttonIndex = 2; buttonIndex < source.gamepad.buttons.length; buttonIndex++) {
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
    let result = new Float32Array(16);

    for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
            result[column * 4 + row] =
                a[row] * b[column * 4] +
                a[4 + row] * b[column * 4 + 1] +
                a[2 * 4 + row] * b[column * 4 + 2] +
                a[3 * 4 + row] * b[column * 4 + 3];
        }
    }

    return result;
}

function renderView(x, y, width, height, mvp, time, xrSphere) {
    let buffer = xrSphere ? sphereBuffer : vertexBuffer;
    let vertexCount = xrSphere ? sphereVertexCount : 6;

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
    let context = overlayContext;
    let width = overlayCanvas.width;
    let height = overlayCanvas.height;

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

    for (let i = 0; i < xrControlDefs.length; i++) {
        drawXRControlRow(context, xrControlDefs[i], i);
    }

    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, overlayCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    overlayDirty = false;
}

function drawXRControlRow(context, definition, index) {
    let rowTop = 138 + index * 43;
    let selected = index === xrSelectedControl;

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
    let status = document.getElementById('xr-status');

    if (status) {
        status.textContent = message;
    }
}
