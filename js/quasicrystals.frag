precision highp float;

#define MAX_LAYERS 128

varying vec2 vTexCoord;
varying vec3 vDirection;

uniform vec2 uResolution;
uniform float uTime;
uniform float uDimPix;
uniform int uLayerCount;
uniform int uColoring;
uniform int uGeometry;
uniform int uXRMode;
uniform vec2 uDirections[MAX_LAYERS];

vec3 sampleGradient(float t, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4) {
    t = clamp(t, 0.0, 1.0);

    if (t < 0.25) {
        return mix(c0, c1, smoothstep(0.0, 0.25, t));
    }

    if (t < 0.5) {
        return mix(c1, c2, smoothstep(0.25, 0.5, t));
    }

    if (t < 0.75) {
        return mix(c2, c3, smoothstep(0.5, 0.75, t));
    }

    return mix(c3, c4, smoothstep(0.75, 1.0, t));
}

vec3 spectrumPalette(float t) {
    return sampleGradient(
        t,
        vec3(1.0, 0.1, 0.2),
        vec3(1.0, 0.85, 0.1),
        vec3(0.0, 0.9, 0.45),
        vec3(0.15, 0.35, 1.0),
        vec3(0.78, 0.2, 1.0)
    );
}

vec3 viridisPalette(float t) {
    return sampleGradient(
        t,
        vec3(0.267, 0.005, 0.329),
        vec3(0.231, 0.322, 0.545),
        vec3(0.129, 0.567, 0.551),
        vec3(0.369, 0.788, 0.382),
        vec3(0.992, 0.906, 0.145)
    );
}

vec3 plasmaPalette(float t) {
    return sampleGradient(
        t,
        vec3(0.050, 0.030, 0.528),
        vec3(0.494, 0.012, 0.658),
        vec3(0.798, 0.280, 0.470),
        vec3(0.973, 0.586, 0.252),
        vec3(0.940, 0.975, 0.131)
    );
}

vec3 cividisPalette(float t) {
    return sampleGradient(
        t,
        vec3(0.000, 0.126, 0.302),
        vec3(0.161, 0.294, 0.476),
        vec3(0.482, 0.477, 0.466),
        vec3(0.790, 0.681, 0.365),
        vec3(1.000, 0.916, 0.275)
    );
}

vec3 turboPalette(float t) {
    return sampleGradient(
        t,
        vec3(0.189, 0.071, 0.232),
        vec3(0.213, 0.441, 0.902),
        vec3(0.098, 0.816, 0.839),
        vec3(0.667, 0.863, 0.196),
        vec3(0.925, 0.114, 0.071)
    );
}

vec3 magmaPalette(float t) {
    return sampleGradient(
        t,
        vec3(0.000, 0.000, 0.016),
        vec3(0.231, 0.059, 0.439),
        vec3(0.716, 0.214, 0.475),
        vec3(0.987, 0.535, 0.382),
        vec3(0.987, 0.991, 0.749)
    );
}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
    vec2 screenUv = screenCoord / max(uResolution, vec2(1.0));
    vec2 centered = (screenUv - 0.5) * uResolution * uDimPix;
    vec3 sphereDirection = normalize(vDirection);

    if (uGeometry == 2 && uXRMode == 0) {
        vec2 screen = screenUv * 2.0 - 1.0;
        float aspect = uResolution.x / max(uResolution.y, 1.0);
        float fov = radians(90.0);
        float focalLength = 1.0 / tan(fov * 0.5);
        vec3 rayDir = normalize(vec3(screen.x * aspect, screen.y, focalLength));
        float longitude = atan(rayDir.x, rayDir.z);
        float latitude = asin(clamp(rayDir.y, -1.0, 1.0));
        float sphereScale = min(uResolution.x, uResolution.y) * uDimPix;

        centered = vec2(longitude, latitude) * sphereScale;
    }

    float sum = 0.0;
    float sphereScale = min(uResolution.x, uResolution.y) * uDimPix;

    for (int i = 0; i < MAX_LAYERS; i++) {
        if (i >= uLayerCount) {
            break;
        }

        vec2 direction = uDirections[i];

        if (uGeometry == 2 && uXRMode == 1) {
            float z = sin((float(i) + 1.0) * 2.39996323);
            vec3 waveDirection = normalize(vec3(direction.x, direction.y, z));
            sum += (cos(dot(waveDirection, sphereDirection) * sphereScale + uTime) + 1.0) * 0.5;
        } else {
            sum += (cos(dot(direction, centered) + uTime) + 1.0) * 0.5;
        }
    }

    float integerSum = floor(sum);
    float decimalSum = fract(sum);
    vec3 color;

    if (uColoring == 1) {
        float grey = mod(integerSum, 2.0) == 0.0 ? decimalSum : 1.0 - decimalSum;
        color = vec3(grey);
    } else if (uColoring == 2) {
        color = spectrumPalette(smoothstep(0.0, 1.0, decimalSum));
    } else if (uColoring == 3) {
        color = viridisPalette(decimalSum);
    } else if (uColoring == 4) {
        color = plasmaPalette(decimalSum);
    } else if (uColoring == 5) {
        color = cividisPalette(decimalSum);
    } else if (uColoring == 6) {
        color = turboPalette(decimalSum);
    } else {
        color = magmaPalette(decimalSum);
    }

    if (uColoring != 1) {
        color = pow(color, vec3(0.85));
        color *= 1.1;
        color = clamp(color, 0.0, 1.0);
    }

    gl_FragColor = vec4(color, 1.0);
}
