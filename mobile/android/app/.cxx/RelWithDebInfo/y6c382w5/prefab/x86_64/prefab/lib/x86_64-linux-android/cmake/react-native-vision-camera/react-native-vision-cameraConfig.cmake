if(NOT TARGET react-native-vision-camera::VisionCamera)
add_library(react-native-vision-camera::VisionCamera SHARED IMPORTED)
set_target_properties(react-native-vision-camera::VisionCamera PROPERTIES
    IMPORTED_LOCATION "D:/down/app/mobile/node_modules/react-native-vision-camera/android/build/intermediates/cxx/RelWithDebInfo/5c2zlf1g/obj/x86_64/libVisionCamera.so"
    INTERFACE_INCLUDE_DIRECTORIES "D:/down/app/mobile/node_modules/react-native-vision-camera/android/build/headers/visioncamera"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

