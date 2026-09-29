(function attachFriendData(global) {
  const friends = [];

  global.BarrelFriends = {
    friends
  };
})(typeof window !== "undefined" ? window : globalThis);
