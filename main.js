import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

let camera, scene, renderer, controls, room, handsGroup;
let interactionHintDiv;
let currentInteractable = null;

const clock = new THREE.Clock();
const EYE_HEIGHT = 1.6;
const ROOM_SIZE = 12;
const roomHalfSize = ROOM_SIZE / 2 - 0.2;
const loader = new GLTFLoader().setPath("/assets/3D/");
const loadedModels = {};

const moveState = { forward: false, backward: false, left: false, right: false };
const moveSpeed = 2.5;

const gasSystem = {
  // PARTICLE SYSTEM PARAMETERS
  maxParticles: 2500,
  spawnPerSecond: 70,
  maxSpeed: 1.4,
  
  // PHYSICS CONSTANTS FOR GAS DYNAMICS
  // Brownian motion coefficient - simulates random molecular collisions
  // Higher values create more chaotic diffusion patterns
  diffusionStrength: 0.35,
  
  // Buoyancy force - natural gas is lighter than air so rises
  // This creates upward acceleration in m/s²
  baseUpdraft: 0.03,
  
  // VENTILATION SYSTEM PARAMETERS
  // Fan force field strength in Newtons equivalent
  fanStrength: 2.2,
  // Maximum effective range of fan airflow in meters
  fanRange: 4.2,
  
  // DISSIPATION ZONES - areas where gas can escape
  // Radius around window where particles are removed (meters)
  windowDissipateRadius: 1.2,
  // Radius around door where particles are removed (meters) - larger than window
  doorDissipateRadius: 1.8,
  
  // SPATIAL POSITIONS (Vector3 coordinates in world space)
  // Leak source position - origin of all gas particles (gas pipe on wall near bed)
  leakSource: new THREE.Vector3(-0.5, 1.2, -5.4),
  // Fan position and directional vector (normalized)
  fanPosition: new THREE.Vector3(0.0, 2.6, -4.8),
  fanDirection: new THREE.Vector3(0, 0, 1).normalize(),
  // Window position for dissipation calculations
  windowPosition: new THREE.Vector3(-5.55, 1.65, 0),
  // Door position for enhanced dissipation
  doorPosition: new THREE.Vector3(0, 1.2, 5.5),
  // Main gas valve position near leak source (removed - using soba as source)
  // valvePosition: new THREE.Vector3(5.0, 1.0, -1.2),
  
  // DYNAMIC STATE VARIABLES
  particlesAlive: 0,
  spawnAccumulator: 0,
  fanOn: false,
  windowOpen: false,
  doorOpen: false,
  // valveClosed: false, // Removed - soba is always active gas source
};

// VENTILATION EFFICIENCY COEFFICIENTS
// These determine how quickly gas dissipates based on active ventilation sources
// Values are based on typical air exchange rates for residential spaces
const VENTILATION_RATES = {
  // Base dissipation when no ventilation is active (natural leakage)
  base: 0.01,
  // Window contribution to air exchange (per second)
  window: 0.15,
  // Door contribution to air exchange (per second) - higher than window
  door: 0.25,
  // Fan contribution to air exchange when active (per second)
  fan: 0.20,
};

let gasPoints;
let gasGeometry;
let gasColors;
let gasPositions;
let gasVelocities;
let gasActive;
let fanGroup;
let fanBladeGroup;
let windowPanel;
let doorMesh;
let valveMesh;
let gasDetectorLight;
let uiConcentration;
let uiFanState;
let uiWindowState;
let uiDoorState;
let uiValveState;
let uiStatus;

const REALISTIC_MODELS = {
  bed: { file: "Bed.glb", position: { x: -0.5, y: 0, z: -4.2 }, scale: { x: 1.5, y: 1.5, z: 1.5 }, rotation: { x: 0, y: 0, z: 0 } },
  closet: { file: "Closet.glb", position: { x: 5.6, y: 0, z: 1.5 }, scale: { x: 0.75, y: 0.75, z: 0.75 }, rotation: { x: 0, y: -Math.PI / 2, z: 0 } },
  bookcase: { file: "Bookcase with Books.glb", position: { x: 5.6, y: 0, z: 0.0 }, scale: { x: 0.7, y: 0.7, z: 0.7 }, rotation: { x: 0, y: -Math.PI / 2, z: 0 } },
  window1: { file: "Window1 white open 1731.glb", position: { x: -5.6, y: 1.6, z: 0.0 }, scale: { x: 0.65, y: 0.65, z: 0.65 }, rotation: { x: 0, y: -Math.PI / 2, z: 0 } },
  ceilingLight: { file: "Light Ceiling.glb", position: { x: 0, y: 2.8, z: 0 }, scale: { x: 1.0, y: 1.0, z: 1.0 }, rotation: { x: 0, y: 0, z: 0 } },
  orchid: { file: "Orchid.glb", position: { x: -4.95, y: 0, z: -4.75 }, scale: { x: 0.25, y: 0.25, z: 0.25 }, rotation: { x: 0, y: -Math.PI / 4, z: 0 } },
  glass: { file: "Glass.glb", position: { x: 5.5, y: 1.1, z: -1.25 }, scale: { x: 0.11, y: 0.11, z: 0.11 }, rotation: { x: 0, y: 0, z: 0 } },
  wallPainting: { file: "Wall painting.glb", position: { x: 2, y: 1.45, z: -5.5 }, scale: { x: 0.1, y: 0.1, z: 0.1 }, rotation: { x: 0, y: Math.PI + Math.PI / 2, z: 0 } },
  rug: { file: "Modern rug.glb", position: { x: 0, y: 0.01, z: 0 }, scale: { x: 0.6, y: 0.6, z: 0.6 }, rotation: { x: 0, y: Math.PI + Math.PI / 2, z: 0 } },
  officeChair: { file: "Office Chair-2.glb", position: { x: 4.6, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: Math.PI, z: 0 } },
  desk: { file: "Desk.glb", position: { x: 5.45, y: 0, z: -1.65 }, scale: { x: 1.0, y: 1.0, z: 1.0 }, rotation: { x: 0, y: -Math.PI / 2, z: 0 } },
  computer: { file: "Profesional PC.glb", position: { x: 0, y: 0, z: 0 }, scale: { x: 5, y: 5, z: 5 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } },
};

function onKeyDown(event) {
  if (event.code === "KeyW") moveState.forward = true;
  if (event.code === "KeyS") moveState.backward = true;
  if (event.code === "KeyA") moveState.left = true;
  if (event.code === "KeyD") moveState.right = true;
  if (event.code === "KeyE" && !event.repeat && currentInteractable) handleInteraction(currentInteractable);
}

function onKeyUp(event) {
  if (event.code === "KeyW") moveState.forward = false;
  if (event.code === "KeyS") moveState.backward = false;
  if (event.code === "KeyA") moveState.left = false;
  if (event.code === "KeyD") moveState.right = false;
}

function clampInsideRoom(position) {
  position.x = THREE.MathUtils.clamp(position.x, -roomHalfSize, roomHalfSize);
  position.z = THREE.MathUtils.clamp(position.z, -roomHalfSize, roomHalfSize);
  position.y = EYE_HEIGHT;
}

function updateFirstPersonMovement(delta) {
  if (!controls.isLocked) return;
  if (!moveState.forward && !moveState.backward && !moveState.left && !moveState.right) return;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const strafe = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const velocity = new THREE.Vector3();

  if (moveState.forward) velocity.add(forward);
  if (moveState.backward) velocity.sub(forward);
  if (moveState.left) velocity.sub(strafe);
  if (moveState.right) velocity.add(strafe);
  if (velocity.lengthSq() === 0) return;
  velocity.normalize().multiplyScalar(moveSpeed * delta);
  camera.position.add(velocity);
  clampInsideRoom(camera.position);
}

function loadModel(modelKey) {
  return new Promise((resolve) => {
    const config = REALISTIC_MODELS[modelKey];
    console.log(`Loading model: ${modelKey} from ${config.file}`);
    loader.load(
      encodeURI(config.file),
      (gltf) => {
        console.log(`Successfully loaded: ${modelKey}`);
        const model = gltf.scene;
        model.position.set(config.position.x, config.position.y, config.position.z);
        model.scale.set(config.scale.x, config.scale.y, config.scale.z);
        model.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.userData.interactableKey = modelKey;
          }
        });
        loadedModels[modelKey] = model;
        resolve(model);
      },
      (progress) => {
        // Optional: Show loading progress
        // console.log(`Loading progress for ${modelKey}:`, (progress.loaded / progress.total * 100) + '%');
      },
      (error) => {
        console.error(`Error loading model ${modelKey}:`, error);
        resolve(null);
      }
    );
  });
}

async function loadAllRealisticModels() {
  console.log("Starting to load all models...");
  const modelKeys = Object.keys(REALISTIC_MODELS);
  console.log("Models to load:", modelKeys);
  
  const results = await Promise.all(modelKeys.map((key) => loadModel(key)));
  console.log("All models loaded. Results:", results.map((model, index) => ({
    key: modelKeys[index],
    loaded: model !== null,
    hasChildren: model ? model.children.length : 0
  })));
}

async function createRoom() {
  room = new THREE.Group();
  const wallHeight = 3;
  const wallThickness = 0.1;

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x99c2de, roughness: 0.9, metalness: 0.05 });
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x8c6a4a, roughness: 0.85, metalness: 0.02 });
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.95, metalness: 0.02 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE, wallThickness, ROOM_SIZE), floorMaterial);
  floor.position.y = -wallThickness / 2;
  room.add(floor);

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE, wallThickness, ROOM_SIZE), ceilingMaterial);
  ceiling.position.y = wallHeight;
  room.add(ceiling);

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE, wallHeight, wallThickness), wallMaterial);
  backWall.position.set(0, wallHeight / 2, -ROOM_SIZE / 2);
  room.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, ROOM_SIZE), wallMaterial);
  leftWall.position.set(-ROOM_SIZE / 2, wallHeight / 2, 0);
  room.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, ROOM_SIZE), wallMaterial);
  rightWall.position.set(ROOM_SIZE / 2, wallHeight / 2, 0);
  room.add(rightWall);

  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE, wallHeight, wallThickness), wallMaterial);
  frontWall.position.set(0, wallHeight / 2, ROOM_SIZE / 2);
  room.add(frontWall);

  await loadAllRealisticModels();
  console.log("Loaded models:", Object.keys(loadedModels));
  console.log("Soba model loaded:", loadedModels.soba ? "YES" : "NO");
  if (loadedModels.soba) {
    console.log("Soba position:", loadedModels.soba.position);
    console.log("Soba scale:", loadedModels.soba.scale);
    console.log("Soba visible:", loadedModels.soba.visible);
    console.log("Soba children count:", loadedModels.soba.children.length);
  }
  
  Object.values(loadedModels).forEach((obj) => {
    if (obj) {
      console.log(`Adding model to room: ${obj.userData.interactableKey || 'unknown'}`);
      room.add(obj);
    }
  });

  console.log("Total objects in room:", room.children.length);
  scene.add(room);
}

function createFanAndWindowInteractables() {
  // FAN CREATION - Rotating fan with force field visualization
  fanGroup = new THREE.Group();
  fanGroup.position.copy(gasSystem.fanPosition);

  // Fan cage - protective housing
  const cage = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 0.08, 24),
    new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.35 })
  );
  cage.rotation.x = Math.PI / 2;
  fanGroup.add(cage);

  // Fan blades - three-blade configuration for balanced airflow
  fanBladeGroup = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.03, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.3, roughness: 0.5 })
    );
    // Distribute blades evenly around 360 degrees
    blade.rotation.z = (Math.PI * 2 * i) / 3;
    fanBladeGroup.add(blade);
  }

  fanGroup.userData.interactable = "fan";
  fanBladeGroup.userData.interactable = "fan";
  fanGroup.add(fanBladeGroup);
  room.add(fanGroup);

  // WINDOW CREATION - Semi-transparent panel with opacity changes
  windowPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 2.1),
    new THREE.MeshStandardMaterial({ color: 0x88c6ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  windowPanel.position.copy(gasSystem.windowPosition);
  windowPanel.rotation.y = Math.PI / 2;
  windowPanel.userData.interactable = "window";
  room.add(windowPanel);

  // DOOR CREATION - Enhanced dissipation zone
  const doorGroup = new THREE.Group();
  doorGroup.position.copy(gasSystem.doorPosition);
  
  // Door frame
  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 2.4, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8, metalness: 0.1 })
  );
  doorGroup.add(doorFrame);
  
  // Door panel - can be opened/closed
  doorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 2.2, 0.9),
    new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.7, metalness: 0.05 })
  );
  doorMesh.position.z = 0.45;
  doorMesh.userData.interactable = "door";
  doorGroup.add(doorMesh);
  
  room.add(doorGroup);

  // VALVE SYSTEM REMOVED - Soba is now the gas source
  // No valve needed - soba continuously emits smoke/gas
}

function createGasParticles() {
  gasGeometry = new THREE.BufferGeometry();
  gasPositions = new Float32Array(gasSystem.maxParticles * 3);
  gasColors = new Float32Array(gasSystem.maxParticles * 3);
  gasVelocities = Array.from({ length: gasSystem.maxParticles }, () => new THREE.Vector3(0, 0, 0));
  gasActive = new Array(gasSystem.maxParticles).fill(false);

  // Initialize particle positions to inactive state (far below room)
  for (let i = 0; i < gasSystem.maxParticles; i++) {
    gasPositions[i * 3 + 1] = -999; // Y position set to -999 to hide inactive particles
    // Gray smoke color palette - realistic smoke from gas pipe
    gasColors[i * 3 + 0] = 0.5; // Red component (medium for gray)
    gasColors[i * 3 + 1] = 0.5; // Green component (medium for gray)
    gasColors[i * 3 + 2] = 0.5; // Blue component (medium for gray)
  }

  gasGeometry.setAttribute("position", new THREE.BufferAttribute(gasPositions, 3));
  gasGeometry.setAttribute("color", new THREE.BufferAttribute(gasColors, 3));

  // BLACK SMOKE/GAS PARTICLE MATERIAL
  // Dark particles with soft blending for realistic smoke from soba
  gasPoints = new THREE.Points(
    gasGeometry,
    new THREE.PointsMaterial({
      size: 0.15,           // Larger size for better smoke coverage
      vertexColors: true,   // Use per-particle colors for variation
      transparent: true,     // Enable transparency for overlapping effect
      opacity: 0.4,          // Moderate opacity for smoke appearance
      depthWrite: false,     // Disable depth writing for proper blending
      blending: THREE.NormalBlending, // Normal blending for smoke effect
      sizeAttenuation: true, // Particles get smaller with distance (perspective)
    })
  );
  scene.add(gasPoints);

  // BLACK GAS PIPE - GAS LEAK SOURCE
  const gasPipeGroup = new THREE.Group();
  
  // Main gas pipe - horizontal black cylinder on wall
  const gasPipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 20.0, 16),
    new THREE.MeshStandardMaterial({ 
      color: 0xffffff, // White
      metalness: 0.8, 
      roughness: 0.3,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    })
  );
  gasPipe.rotation.z = Math.PI / 2; // Rotate to horizontal
  gasPipe.position.set(-0.5, 2.8, -5.4); // Position on wall near bed
  gasPipeGroup.add(gasPipe);
  
  // Gas leak point - damaged section with visible gas escape
  const leakPoint = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      emissive: 0x111111, 
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.8
    })
  );
  leakPoint.position.copy(gasSystem.leakSource);
  gasPipeGroup.add(leakPoint);
  
  // Pipe brackets - mounting hardware
  const bracket1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.9, roughness: 0.2 })
  );
  bracket1.position.set(-1.5, 1.2, -5.4);
  gasPipeGroup.add(bracket1);
  
  const bracket2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.9, roughness: 0.2 })
  );
  bracket2.position.set(0.5, 1.2, -5.4);
  gasPipeGroup.add(bracket2);
  
  room.add(gasPipeGroup);
}

function spawnParticle() {
  // Find first inactive particle slot using linear search
  const idx = gasActive.findIndex((alive) => !alive);
  if (idx < 0) return; // No available slots - max particles reached

  // Activate particle and increment alive counter
  gasActive[idx] = true;
  gasSystem.particlesAlive++;

  // Calculate buffer array index (3 components per vertex: x,y,z)
  const p = idx * 3;
  
  // INITIAL POSITION WITH SPATIAL VARIATION
  // Particles spawn at leak source with small random offset
  // This simulates turbulent flow from the leak point
  // Offset range: ±0.04 meters in each axis
  gasPositions[p + 0] = gasSystem.leakSource.x + (Math.random() - 0.5) * 0.08;
  gasPositions[p + 1] = gasSystem.leakSource.y + (Math.random() - 0.5) * 0.08;
  gasPositions[p + 2] = gasSystem.leakSource.z + (Math.random() - 0.5) * 0.08;
  
  // INITIAL VELOCITY DISTRIBUTION
  // Random initial velocities simulate pressure-driven turbulent flow
  // X,Z components: ±0.1 m/s (horizontal spread)
  // Y component: 0 to 0.16 m/s (upward bias due to buoyancy)
  gasVelocities[idx].set(
    (Math.random() - 0.5) * 0.2,  // Horizontal X velocity
    Math.random() * 0.16,          // Upward Y velocity (gas rises)
    (Math.random() - 0.5) * 0.2   // Horizontal Z velocity
  );
}

function killParticle(idx) {
  if (!gasActive[idx]) return;
  gasActive[idx] = false;
  gasSystem.particlesAlive--;
  const p = idx * 3;
  gasPositions[p + 1] = -999;
  gasVelocities[idx].set(0, 0, 0);
}

function updateGasSimulation(deltaTime) {
  // PARTICLE SPAWNING FROM SOBA
  // Soba continuously emits gas particles (no valve control)
  if (true) {
    gasSystem.spawnAccumulator += gasSystem.spawnPerSecond * deltaTime;
    while (gasSystem.spawnAccumulator >= 1) {
      spawnParticle();
      gasSystem.spawnAccumulator -= 1;
    }
  }

  // VENTILATION DISSIPATION CALCULATION
  // Calculate total dissipation rate based on active ventilation sources
  // This models air exchange rates in cubic meters per second
  let totalDissipationRate = VENTILATION_RATES.base; // Natural leakage always active
  
  if (gasSystem.windowOpen) totalDissipationRate += VENTILATION_RATES.window;
  if (gasSystem.doorOpen) totalDissipationRate += VENTILATION_RATES.door; // Door has higher rate
  if (gasSystem.fanOn) totalDissipationRate += VENTILATION_RATES.fan;
  
  // Apply stochastic dissipation - randomly remove particles based on ventilation rate
  const dissipationProbability = Math.min(totalDissipationRate * deltaTime, 0.1); // Cap at 10% per frame
  for (let i = 0; i < gasSystem.maxParticles; i++) {
    if (gasActive[i] && Math.random() < dissipationProbability) {
      killParticle(i);
    }
  }

  // VECTOR MATH TEMPORARIES FOR PARTICLE PHYSICS
  const particlePosition = new THREE.Vector3();
  const fanToParticle = new THREE.Vector3();
  const randomDiffusionImpulse = new THREE.Vector3();

  // PARTICLE PHYSICS UPDATE LOOP
  for (let i = 0; i < gasSystem.maxParticles; i++) {
    if (!gasActive[i]) continue; // Skip inactive particles

    // Extract particle position from buffer arrays
    const p = i * 3;
    particlePosition.set(
      gasPositions[p + 0], // X coordinate
      gasPositions[p + 1], // Y coordinate  
      gasPositions[p + 2]  // Z coordinate
    );
    const velocity = gasVelocities[i];

    // 1) BROWNIAN DIFFUSION TERM - MOLECULAR COLLISION SIMULATION
    // Random walk approximation of gas molecule collisions
    // Each component generates random impulse in [-0.5, +0.5] range
    // Multiplying by diffusionStrength*dt converts to velocity change (m/s)
    // This models the kinetic theory of gases where particles undergo random motion
    randomDiffusionImpulse.set(
      Math.random() - 0.5,  // Random X impulse
      Math.random() - 0.5,  // Random Y impulse
      Math.random() - 0.5   // Random Z impulse
    );
    randomDiffusionImpulse.multiplyScalar(gasSystem.diffusionStrength * deltaTime);
    velocity.add(randomDiffusionImpulse);

    // 2) BUOYANCY FORCE - GAS DENSITY DIFFERENTIAL
    // Natural gas (methane) has density ~0.656 kg/m³ vs air 1.225 kg/m³
    // This creates upward acceleration due to buoyancy: a = g * (ρ_air - ρ_gas) / ρ_gas
    // We simplify this as constant upward acceleration
    // Integration: v_new = v_old + a * dt
    velocity.y += gasSystem.baseUpdraft * deltaTime;

    // 3) FAN FORCE FIELD - VECTOR FIELD DYNAMICS
    // Implements directional airflow using vector mathematics
    if (gasSystem.fanOn) {
      // Calculate vector from fan to particle
      fanToParticle.subVectors(particlePosition, gasSystem.fanPosition);
      
      // PROJECT PARTICLE POSITION ONTO FAN AXIS
      // Dot product gives scalar projection: |a|cos(θ) where θ is angle between vectors
      // This tells us how far along the fan's direction the particle is
      const axialDistance = fanToParticle.dot(gasSystem.fanDirection);
      
      // Check if particle is in fan's effective cone (in front and within range)
      if (axialDistance > 0 && axialDistance < gasSystem.fanRange) {
        // CALCULATE RADIAL OFFSET FROM FAN CENTERLINE
        // Remove axial component to get perpendicular distance
        // radialOffset = fanToParticle - (fanDirection * axialDistance)
        const radialOffset = fanToParticle
          .clone()
          .sub(gasSystem.fanDirection.clone().multiplyScalar(axialDistance));

        // FORCE FALLOFF CALCULATION
        // Models realistic fan airflow with cone-shaped distribution
        // Radial falloff: force decreases with distance from centerline
        // Axial falloff: force decreases with distance from fan
        const radialFalloff = Math.max(0, 1 - radialOffset.length() / 1.2);
        const axialFalloff = Math.max(0, 1 - axialDistance / gasSystem.fanRange);
        
        // COMBINED FORCE MAGNITUDE
        // Force = base_strength * radial_falloff * axial_falloff
        const forceMagnitude = gasSystem.fanStrength * radialFalloff * axialFalloff;
        
        // APPLY FORCE IN FAN DIRECTION
        // F = ma, so acceleration = F/m. We assume unit mass for simplicity
        // velocity += direction * force * dt
        velocity.addScaledVector(gasSystem.fanDirection, forceMagnitude * deltaTime);
      }
    }

    // VELOCITY LIMITING - PREVENT NUMERICAL INSTABILITY
    // Cap maximum speed to maintain simulation stability
    if (velocity.length() > gasSystem.maxSpeed) {
      velocity.setLength(gasSystem.maxSpeed);
    }

    // EXPLICIT EULER INTEGRATION - POSITION UPDATE
    // Fundamental numerical integration: x(t+dt) = x(t) + v(t) * dt
    // This is first-order accurate but computationally efficient
    particlePosition.addScaledVector(velocity, deltaTime);

    // 4) DISSIPATION ZONE CHECKING - VENTILATION OUTLETS
    // Check if particle is within dissipation radius of ventilation sources
    
    // Window dissipation - particles escape through open window
    if (gasSystem.windowOpen && 
        particlePosition.distanceTo(gasSystem.windowPosition) < gasSystem.windowDissipateRadius) {
      killParticle(i);
      continue; // Skip to next particle
    }
    
    // Door dissipation - enhanced airflow through open door
    if (gasSystem.doorOpen && 
        particlePosition.distanceTo(gasSystem.doorPosition) < gasSystem.doorDissipateRadius) {
      killParticle(i);
      continue; // Skip to next particle
    }

    // 5) ROOM BOUNDARY COLLISION - INELASTIC COLLISION MODEL
    // Simple axis-aligned boundary collision with energy loss
    // Coefficient of restitution: 0.55 for walls, 0.45 for floor/ceiling
    
    // Check each axis independently and apply velocity reversal with damping
    if (particlePosition.x < -roomHalfSize || particlePosition.x > roomHalfSize) {
      velocity.x *= -0.55; // Wall collision with 45% energy loss
    }
    if (particlePosition.y < 0.02 || particlePosition.y > 2.95) {
      velocity.y *= -0.45; // Floor/ceiling collision with 55% energy loss
    }
    if (particlePosition.z < -roomHalfSize || particlePosition.z > roomHalfSize) {
      velocity.z *= -0.55; // Wall collision with 45% energy loss
    }

    // POSITION CLAMPING - KEEP PARTICLES INSIDE ROOM
    // Prevent particles from escaping through numerical errors
    particlePosition.x = THREE.MathUtils.clamp(particlePosition.x, -roomHalfSize, roomHalfSize);
    particlePosition.y = THREE.MathUtils.clamp(particlePosition.y, 0.02, 2.95);
    particlePosition.z = THREE.MathUtils.clamp(particlePosition.z, -roomHalfSize, roomHalfSize);

    // UPDATE PARTICLE POSITION IN BUFFER
    gasPositions[p + 0] = particlePosition.x;
    gasPositions[p + 1] = particlePosition.y;
    gasPositions[p + 2] = particlePosition.z;
  }

  // MARK GEOMETRY FOR GPU UPDATE
  gasGeometry.attributes.position.needsUpdate = true;
}

function createGasDetector() {
  const detector = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.12, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x335533, roughness: 0.7, metalness: 0.1 })
  );
  body.position.set(0.24, -0.22, -0.55);
  detector.add(body);

  gasDetectorLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.8 })
  );
  gasDetectorLight.position.set(0.26, -0.19, -0.4);
  detector.add(gasDetectorLight);

  camera.add(detector);
}

function createProceduralHands() {
  handsGroup = new THREE.Group();
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xe0ac69, roughness: 0.6, metalness: 0.05 });

  const createHand = (isRight) => {
    const hand = new THREE.Group();
    const side = isRight ? 1 : -1;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.5, 12), skinMaterial);
    arm.rotation.x = Math.PI / 2 - 0.2;
    arm.position.set(0.25 * side, -0.35, -0.15);
    hand.add(arm);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.12), skinMaterial);
    palm.position.set(0.25 * side, -0.28, -0.42);
    hand.add(palm);
    return hand;
  };

  handsGroup.add(createHand(false));
  handsGroup.add(createHand(true));
  camera.add(handsGroup);
}

function setupUiRefs() {
  // UI ELEMENT REFERENCES - CACHED FOR PERFORMANCE
  uiConcentration = document.getElementById("gasConcentration");
  uiFanState = document.getElementById("fanState");
  uiWindowState = document.getElementById("windowState");
  uiDoorState = document.getElementById("doorState");
  // uiValveState = document.getElementById("valveState"); // Removed - no valve system
  uiStatus = document.getElementById("hazardStatus");
}

function handleInteraction(interactable) {
  // INTERACTION HANDLER - TOGGLE VENTILATION AND GAS CONTROL SYSTEMS
  
  if (interactable.type === "fan") {
    gasSystem.fanOn = !gasSystem.fanOn;
    console.log(`Fan ${gasSystem.fanOn ? 'activated' : 'deactivated'} - Airflow: ${gasSystem.fanOn ? 'ON' : 'OFF'}`);
  }
  
  if (interactable.type === "window") {
    gasSystem.windowOpen = !gasSystem.windowOpen;
    console.log(`Window ${gasSystem.windowOpen ? 'opened' : 'closed'} - Natural ventilation: ${gasSystem.windowOpen ? 'ACTIVE' : 'INACTIVE'}`);
  }
  
  if (interactable.type === "door") {
    gasSystem.doorOpen = !gasSystem.doorOpen;
    console.log(`Door ${gasSystem.doorOpen ? 'opened' : 'closed'} - Enhanced ventilation: ${gasSystem.doorOpen ? 'ACTIVE' : 'INACTIVE'}`);
    
    // Animate door rotation when opening/closing
    if (doorMesh) {
      if (gasSystem.doorOpen) {
        doorMesh.rotation.y = -Math.PI / 2; // Open door 90 degrees
      } else {
        doorMesh.rotation.y = 0; // Close door
      }
    }
  }
  
  // VALVE INTERACTION REMOVED - No valve system with soba
}

function updateInteraction() {
  // RAYCASTING-BASED INTERACTION SYSTEM
  // Casts ray from camera center to detect interactable objects within range
  
  if (!controls.isLocked) {
    if (interactionHintDiv) interactionHintDiv.style.display = "none";
    return;
  }

  // Create raycaster from camera center (crosshair position)
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  
  // Find all intersected objects in the room hierarchy
  const hits = raycaster.intersectObjects(room.children, true);
  currentInteractable = null;
  let hint = "";

  // Check closest intersection within interaction range (3.5 meters)
  if (hits.length > 0 && hits[0].distance < 3.5) {
    const key = hits[0].object.userData?.interactable || hits[0].object.parent?.userData?.interactable;
    
    // FAN INTERACTION
    if (key === "fan") {
      currentInteractable = { type: "fan" };
      hint = `Fan [E]: ${gasSystem.fanOn ? "Turn OFF" : "Turn ON"}`;
    } 
    // WINDOW INTERACTION
    else if (key === "window" || hits[0].object.userData?.interactableKey === "window1") {
      currentInteractable = { type: "window" };
      hint = `Window [E]: ${gasSystem.windowOpen ? "Close" : "Open"}`;
    }
    // DOOR INTERACTION
    else if (key === "door") {
      currentInteractable = { type: "door" };
      hint = `Door [E]: ${gasSystem.doorOpen ? "Close" : "Open"}`;
    }
    // VALVE INTERACTION REMOVED - No valve system with soba
  }

  // Create or update interaction hint display
  if (!interactionHintDiv) {
    interactionHintDiv = document.createElement("div");
    interactionHintDiv.id = "interactionHint";
    document.body.appendChild(interactionHintDiv);
  }
  interactionHintDiv.textContent = hint;
  interactionHintDiv.style.display = currentInteractable ? "block" : "none";
}

function updateUiAndHazard() {
  // GAS CONCENTRATION CALCULATION
  // Percentage based on active particle count vs maximum capacity
  // This represents volumetric gas concentration in the room
  const concentration = (gasSystem.particlesAlive / gasSystem.maxParticles) * 100;
  
  // DANGER THRESHOLD CHECK
  // 70% concentration represents dangerous gas levels
  const danger = concentration >= 70;
  document.body.classList.toggle("danger-state", danger);

  // UPDATE UI DISPLAYS
  if (uiConcentration) uiConcentration.textContent = `${concentration.toFixed(1)}%`;
  if (uiFanState) uiFanState.textContent = gasSystem.fanOn ? "ON" : "OFF";
  if (uiWindowState) uiWindowState.textContent = gasSystem.windowOpen ? "OPEN" : "CLOSED";
  if (uiDoorState) uiDoorState.textContent = gasSystem.doorOpen ? "OPEN" : "CLOSED";
  // if (uiValveState) uiValveState.textContent = gasSystem.valveClosed ? "CLOSED" : "OPEN"; // Removed - no valve system
  if (uiStatus) uiStatus.textContent = danger ? "DANGER" : "SAFE";

  // ANIMATE INTERACTABLE OBJECTS
  // Fan blade rotation when active
  if (fanBladeGroup && gasSystem.fanOn) {
    fanBladeGroup.rotation.z += 0.35; // Rotation speed in radians per frame
  }
  
  // Window transparency changes based on state
  if (windowPanel) {
    windowPanel.material.opacity = gasSystem.windowOpen ? 0.2 : 0.55;
  }

  // GAS DETECTOR COLOR INTERPOLATION
  // Distance-based color gradient from green (safe) to red (danger)
  // 
  // MATHEMATICAL FORMULATION:
  // Let d = Euclidean distance from camera to leak source
  // Let d_max = Maximum detection range (8 meters)
  // Normalized distance: t = clamp(1 - d/d_max, 0, 1)
  // 
  // When d = 0 (at leak source): t = 1 (fully red)
  // When d = d_max: t = 0 (fully green)
  // When d > d_max: t = 0 (fully green, out of range)
  //
  // Color interpolation uses linear interpolation in RGB space:
  // color(t) = green * (1-t) + red * t
  
  const leakDistance = camera.position.distanceTo(gasSystem.leakSource);
  const t = THREE.MathUtils.clamp(1 - leakDistance / 8, 0, 1);
  const color = new THREE.Color(0x00ff00).lerp(new THREE.Color(0xff0000), t);
  
  // Apply color to detector light (both diffuse and emissive)
  gasDetectorLight.material.color.copy(color);
  gasDetectorLight.material.emissive.copy(color);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  updateFirstPersonMovement(delta);
  updateInteraction();
  updateGasSimulation(delta);
  updateUiAndHazard();
  if (handsGroup) handsGroup.position.y = Math.sin(performance.now() * 0.0015) * 0.004;
    renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function init() {
  const container = document.createElement("div");
  document.body.appendChild(container);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, EYE_HEIGHT, 2.0);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 8, 20);

  await createRoom();
  createFanAndWindowInteractables();
  createGasParticles();
  createGasDetector();
  createProceduralHands();
  setupUiRefs();

  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  container.appendChild(renderer.domElement);

  controls = new PointerLockControls(camera, document.body);
  document.addEventListener("click", (event) => {
    if (!controls.isLocked && event.target.tagName !== "BUTTON") controls.lock();
  });

  const ambient = new THREE.AmbientLight(0xffffff, 1.2);
  const hemi = new THREE.HemisphereLight(0xe8f4fc, 0x8b7355, 0.5);
  const key1 = new THREE.PointLight(0xffffee, 2.0, 10);
  const key2 = new THREE.PointLight(0xffffee, 2.0, 10);
  key1.position.set(-1, 2.8, -1);
  key2.position.set(1, 2.8, 1);
  scene.add(ambient, hemi, key1, key2);

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", onWindowResize);
}

async function initApp() {
  await init();
  animate();
}

initApp().catch((err) => {
  console.error("initApp hatasi:", err);
});
