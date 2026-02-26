#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'msgpack'

INPUT_PATH = File.expand_path('../legacy/slowverb.com/models/dictionaries/slow_verb.mmd', __dir__)
OUTPUT_PATH = File.expand_path('../public/chain-legacy.json', __dir__)

unpacker = MessagePack::Unpacker.new
unpacker.feed(File.binread(INPUT_PATH))

objects = []
unpacker.each { |object| objects << object }

unless objects.length == 2 && objects[1].is_a?(Hash)
  raise "Unexpected dictionary format: #{objects.map(&:class).inspect}"
end

chain = objects[1]
compact_chain = {}
chain.each do |key, value|
  compact_chain[key.join(' ')] = value
end

Dir.mkdir(File.dirname(OUTPUT_PATH)) unless Dir.exist?(File.dirname(OUTPUT_PATH))
File.write(OUTPUT_PATH, JSON.generate(compact_chain))

puts "Wrote #{compact_chain.length} keys to #{OUTPUT_PATH}"
